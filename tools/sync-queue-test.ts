// Self-check for src/lib/syncQueue.ts — run with: npx tsx tools/sync-queue-test.ts
import { createSyncQueue, createDrainer, type QueueOp } from "../src/lib/syncQueue";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "OK  " : "FAIL", name, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
};

// ---- merge rules ----
{
  const q = createSyncQueue(null);
  q.add("orders", "a", "upsert", { row: { id: "a", status: "served" } });
  q.add("orders", "a", "upsert", { row: { id: "a", status: "billed" } });
  eq("newer upsert replaces older", q.get("orders:a")?.row, { id: "a", status: "billed" });
  q.add("orders", "a", "update", { patch: { note: "x" } });
  eq("update folds into a queued upsert", q.get("orders:a")?.row, { id: "a", status: "billed", note: "x" });
  q.add("orders", "a", "delete");
  eq("delete replaces everything", q.get("orders:a")?.kind, "delete");
  eq("update after delete is dropped", q.add("orders", "a", "update", { patch: { note: "y" } }), null);
  q.add("tables", "t", "update", { patch: { status: "running" } });
  q.add("tables", "t", "update", { patch: { accumulated_ms: 5 } });
  eq("two updates merge", q.get("tables:t")?.patch, { status: "running", accumulated_ms: 5 });
  eq("numeric ids work", q.add("store_settings", 1, "upsert", { row: { id: 1 } })?.key, "store_settings:1");
}

// ---- persistence ----
{
  const s = mem();
  const q1 = createSyncQueue(s);
  q1.add("orders", "a", "upsert", { row: { id: "a", status: "billed" } });
  const q2 = createSyncQueue(s); // "reload"
  eq("queue survives a reload", q2.get("orders:a")?.row, { id: "a", status: "billed" });
  const op = q2.get("orders:a")!;
  q2.add("orders", "a", "upsert", { row: { id: "a", status: "served", v: 2 } }); // newer while "in flight"
  q2.ack(op);
  eq("ack of an older op keeps the newer one", q2.get("orders:a")?.row, { id: "a", status: "served", v: 2 });
  q2.ack(q2.get("orders:a")!);
  eq("ack of the current op clears it", q2.get("orders:a"), undefined);
  eq("...and is persisted", createSyncQueue(s).all().length, 0);
  eq("corrupt storage is ignored", createSyncQueue({ getItem: () => "{not json", setItem: () => {} }).all().length, 0);
}

// ---- overlay (the actual bug: a sync must not undo an unconfirmed write) ----
{
  const q = createSyncQueue(null);
  const cloud = [
    { id: "1", status: "served", n: 1 },
    { id: "2", status: "served", n: 2 },
    { id: "3", status: "served", n: 3 },
  ];
  q.add("orders", "1", "upsert", { row: { id: "1", status: "billed", n: 1 } }); // billed locally, never reached the cloud
  q.add("orders", "2", "delete"); // deleted locally, never reached the cloud
  q.add("orders", "9", "upsert", { row: { id: "9", status: "served", n: 9 } }); // created locally, never reached the cloud
  q.add("orders", "3", "update", { patch: { status: "billed" } });
  q.add("bills", "x", "delete"); // another table — must not leak
  const merged = q.overlayRows("orders", cloud);
  eq("sync keeps the unconfirmed 'billed'", merged.find((r) => r.id === "1")?.status, "billed");
  eq("sync keeps the unconfirmed delete", merged.some((r) => r.id === "2"), false);
  eq("sync keeps the unconfirmed new row", merged.some((r) => r.id === "9"), true);
  eq("sync applies a queued update", merged.find((r) => r.id === "3")?.status, "billed");
  eq("other tables are untouched", q.overlayRows("bills", [{ id: "x" }]).length, 0);
  eq("nothing queued -> same array", q.overlayRows("expenses", cloud), cloud);
  eq("realtime echo of old data is overridden", q.overlayRow("orders", "1", { id: "1", status: "served" } as { id: string; status: string }), { id: "1", status: "billed", n: 1 });
  eq("realtime row for a deleted id is ignored", q.overlayRow("orders", "2", { id: "2" }), null);
  eq("no op -> incoming passes through", q.overlayRow("orders", "77", { id: "77" }), { id: "77" });
}

// ---- drainer ----
(async () => {
  {
    const q = createSyncQueue(null);
    const sent: string[] = [];
    let online = false;
    const d = createDrainer(q, async (op: QueueOp) => {
      if (!online) return false;
      sent.push(`${op.key}:${JSON.stringify(op.row ?? op.patch ?? "del")}`);
      return true;
    });
    q.add("orders", "a", "upsert", { row: { id: "a", s: 1 } });
    eq("failed send reports false", await d.drain("orders:a"), false);
    eq("...and stays queued", q.all().length, 1);
    online = true;
    d.flush();
    await new Promise((r) => setTimeout(r, 20));
    eq("flush retries and clears it", [q.all().length, sent.length], [0, 1]);
  }
  {
    // a newer write arrives while the first is in flight: both go out, in order, nothing is lost
    const q = createSyncQueue(null);
    const sent: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const d = createDrainer(q, async (op) => {
      if (first) {
        first = false;
        await gate;
      }
      sent.push((op.row as { v: number }).v);
      return true;
    });
    q.add("orders", "a", "upsert", { row: { id: "a", v: 1 } });
    const p1 = d.drain("orders:a");
    q.add("orders", "a", "upsert", { row: { id: "a", v: 2 } });
    const p2 = d.drain("orders:a"); // joins the running drain, no second request
    release();
    await Promise.all([p1, p2]);
    eq("newer write sent after the in-flight one", sent, [1, 2]);
    eq("queue empty afterwards", q.all().length, 0);
  }
  {
    // a row that always fails is retried a bounded number of times, then left for next session
    const q = createSyncQueue(null);
    let calls = 0;
    const d = createDrainer(q, async () => {
      calls++;
      return false;
    }, 3);
    q.add("orders", "bad", "upsert", { row: { id: "bad" } });
    for (let i = 0; i < 10; i++) {
      d.flush();
      await new Promise((r) => setTimeout(r, 5));
    }
    eq("failure cap stops hammering", calls, 3);
    eq("...but the write is still queued", q.all().length, 1);
  }
  console.log(failed === 0 ? "\nALL SYNC-QUEUE TESTS PASSED" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
