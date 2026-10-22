// A durable "not yet confirmed saved" queue for writes to the cloud.
//
// The problem it solves: every store writes to Supabase fire-and-forget while
// updating its own local copy straight away, and every fresh fetch / reconnect
// then REPLACES local state with whatever the cloud has. A write that didn't
// reach the cloud (weak wifi, a request that died mid-flight, the tab closed
// right after the tap) was therefore quietly undone the next time the app
// synced — an order flipped back from "billed" to "served", an edit or a
// deletion reappeared. This queue remembers each unconfirmed write (on disk, so
// it survives a reload), retries it until the server confirms, and lets a sync
// lay it back over the cloud's data instead of losing it.
//
// Per table row there is at most one queued write — a newer write for the
// same row replaces/merges into the older one, so what's retried is always the
// latest intent, never a stale snapshot.

export type QueueOp = {
  key: string;
  table: string;
  id: string | number;
  kind: "upsert" | "update" | "delete";
  row?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  seq: number;
};

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createSyncQueue(storage: QueueStorage | null, storageKey = "cuebill-sync-queue") {
  const ops = new Map<string, QueueOp>();
  let seq = 0;

  try {
    const raw = storage?.getItem(storageKey);
    if (raw) {
      for (const op of JSON.parse(raw) as QueueOp[]) {
        ops.set(op.key, op);
        seq = Math.max(seq, op.seq);
      }
    }
  } catch {
    // unreadable / disabled storage — start empty, still works in memory
  }

  const persist = () => {
    try {
      storage?.setItem(storageKey, JSON.stringify([...ops.values()]));
    } catch {
      // storage full / disabled — the in-memory queue still retries this session
    }
  };
  const keyOf = (table: string, id: string | number) => `${table}:${id}`;

  // Queue a write. Returns the op to send, or null when there is nothing to
  // send (an update arriving after a delete of the same row).
  function add(
    table: string,
    id: string | number,
    kind: QueueOp["kind"],
    payload: { row?: Record<string, unknown>; patch?: Record<string, unknown> } = {}
  ): QueueOp | null {
    const key = keyOf(table, id);
    const prev = ops.get(key);
    let next: QueueOp;
    if (kind === "delete") {
      next = { key, table, id, kind, seq: ++seq };
    } else if (kind === "upsert") {
      next = { key, table, id, kind, row: payload.row ?? {}, seq: ++seq };
    } else if (!prev) {
      next = { key, table, id, kind, patch: payload.patch ?? {}, seq: ++seq };
    } else if (prev.kind === "delete") {
      return null;
    } else if (prev.kind === "upsert") {
      // fold the change into the full row that is still waiting to go out
      next = { key, table, id, kind: "upsert", row: { ...prev.row, ...payload.patch }, seq: ++seq };
    } else {
      next = { key, table, id, kind: "update", patch: { ...prev.patch, ...payload.patch }, seq: ++seq };
    }
    ops.set(key, next);
    persist();
    return next;
  }

  const get = (key: string) => ops.get(key);
  const all = () => [...ops.values()];

  // The server confirmed this op — drop it, unless a newer write for the same
  // row was queued while it was in flight (that one still has to go out).
  function ack(op: QueueOp) {
    const cur = ops.get(op.key);
    if (cur && cur.seq === op.seq) {
      ops.delete(op.key);
      persist();
    }
  }

  // Lay unconfirmed writes over a list of rows fetched from the cloud, so a
  // sync can't undo them: a queued upsert replaces (or adds) its row, a queued
  // update is merged in, a queued delete removes the row.
  function overlayRows<T extends { id: string | number }>(table: string, rows: T[]): T[] {
    const mine = all().filter((o) => o.table === table);
    if (mine.length === 0) return rows;
    const byId = new Map<string, T>(rows.map((r) => [String(r.id), r]));
    for (const op of mine) {
      const id = String(op.id);
      if (op.kind === "delete") byId.delete(id);
      else if (op.kind === "upsert") byId.set(id, op.row as unknown as T);
      else {
        const cur = byId.get(id);
        if (cur) byId.set(id, { ...cur, ...op.patch } as T);
      }
    }
    return [...byId.values()];
  }

  // Same, for one row that just arrived over realtime. null = ignore it.
  function overlayRow<T extends object>(table: string, id: string | number, incoming: T | null): T | null {
    const op = ops.get(keyOf(table, id));
    if (!op) return incoming;
    if (op.kind === "delete") return null;
    if (op.kind === "upsert") return op.row as unknown as T;
    return incoming ? ({ ...incoming, ...op.patch } as T) : null;
  }

  return { add, get, all, ack, overlayRows, overlayRow, keyOf };
}

export type SyncQueue = ReturnType<typeof createSyncQueue>;

// Sends queued writes, one drain loop per row so a row is never written by two
// requests at once and the newest queued write is always the last to go out.
export function createDrainer(
  queue: SyncQueue,
  send: (op: QueueOp) => Promise<boolean>,
  maxFailures = 8
) {
  const running = new Map<string, Promise<boolean>>();
  const failures = new Map<string, number>();

  function drain(key: string): Promise<boolean> {
    const cur = running.get(key);
    if (cur) return cur;
    const p = (async () => {
      try {
        for (;;) {
          const op = queue.get(key);
          if (!op) return true;
          const ok = await send(op);
          if (!ok) {
            failures.set(key, (failures.get(key) ?? 0) + 1);
            return false;
          }
          failures.delete(key);
          queue.ack(op);
          if (!queue.get(key)) return true;
          // a newer write for this row arrived while that one was in flight — send it too
        }
      } finally {
        running.delete(key);
      }
    })();
    running.set(key, p);
    return p;
  }

  // Retry everything still waiting. A row that keeps failing is left alone for
  // the rest of the session (it stays queued and is tried again after a reload)
  // rather than hammering the server forever.
  function flush() {
    for (const op of queue.all()) {
      if ((failures.get(op.key) ?? 0) >= maxFailures) continue;
      void drain(op.key);
    }
  }

  // A fresh write for a row gets a clean slate.
  const resetFailures = (key: string) => failures.delete(key);

  return { drain, flush, resetFailures };
}
