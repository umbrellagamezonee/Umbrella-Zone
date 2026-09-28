import { supabase } from "./supabaseClient";

// Set right before a Backup & Restore reload (see markRestoreInProgress in
// Settings.tsx's BackupModal) — tells every store's initial fetch below that
// local state (just rehydrated from the restored backup, migrations and
// all) is authoritative this one time, so it should be *pushed* to the
// cloud instead of merged with whatever's currently there. Otherwise a
// restore is a no-op for any record still present in the cloud: the normal
// initial fetch treats the cloud as the source of truth, so Tuesday's data
// silently wins right back over Monday's restored backup the instant this
// reload's fetch resolves.
//
// Cleared a few seconds after this module loads — every store's initial
// fetch fires at module-load time, well inside that window, so a later,
// completely unrelated reload never mistakes itself for a pending restore.
const RESTORE_FLAG = "cuebill-restore-in-progress";
export function markRestoreInProgress() {
  try {
    sessionStorage.setItem(RESTORE_FLAG, "1");
  } catch {
    // Private browsing / storage disabled — restore still works locally,
    // it just won't also push to the cloud.
  }
}
function isRestoreInProgress(): boolean {
  try {
    return sessionStorage.getItem(RESTORE_FLAG) === "1";
  } catch {
    return false;
  }
}
if (typeof window !== "undefined") {
  setTimeout(() => {
    try {
      sessionStorage.removeItem(RESTORE_FLAG);
    } catch {
      // ignore
    }
  }, 5000);
}

// PostgREST caps an unranged select at its own default row limit (1000 on
// this project) — a table that's grown past that would otherwise have its
// initial fetch silently truncated, with no error, to whichever 1000 rows
// happen to come back. Every device that's ever offline/reset for long
// enough to need this initial fetch (not just brand-new ones) is exposed —
// a busy shop's bills table crosses 1000 rows within days. Paging through
// with .range() until a page comes back short (rather than trusting a
// single response) gets the whole table regardless of size. Ordering by id
// isn't meaningful on its own, just stable — without *some* explicit order
// PostgREST doesn't guarantee row order stays put between one range request
// and the next, which could skip or repeat rows across pages.
const FETCH_PAGE_SIZE = 1000;
async function fetchAllRows<TRow>(
  table: string
): Promise<{ data: TRow[] | null; error: { message: string } | null }> {
  const all: TRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase!
      .from(table)
      .select("*")
      .order("id")
      .range(from, from + FETCH_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    all.push(...(data as TRow[]));
    if (data.length < FETCH_PAGE_SIZE) break;
    from += FETCH_PAGE_SIZE;
  }
  return { data: all, error: null };
}

// Shared plumbing every synced store uses: on load, pull the table down and
// replace local state with it; from then on, a realtime subscription keeps
// local state in sync with whatever any other device writes. Each store's
// own mutating actions call the push* helpers below to write through.
//
// If the cloud table is still empty (first-ever setup) this device's local
// data — seed data or whatever was already entered before cloud sync was
// turned on — becomes the seed instead of getting silently wiped out.
//
// No-ops entirely when Supabase isn't configured (supabase === null) — the
// app just stays local-only, same as before cloud sync existed.
export function setupSync<TRow extends { id: string }, TItem>(
  table: string,
  fromRow: (row: TRow) => TItem,
  toRow: (item: TItem) => TRow,
  getLocal: () => TItem[],
  applyInitial: (items: TItem[]) => void,
  applyUpsert: (item: TItem) => void,
  applyDelete: (id: string) => void
) {
  if (!supabase) return;

  fetchAllRows<TRow>(table).then(({ data, error }) => {
    if (error) {
      console.error(`[cloudSync] initial fetch of "${table}" failed`, error);
      return;
    }
    if (isRestoreInProgress()) {
      const local = getLocal();
      if (local.length > 0) bulkUpsertWithRetry(table, local.map(toRow) as Record<string, unknown>[]);
      return;
    }
    if (data && data.length > 0) {
      applyInitial(data.map(fromRow));
      return;
    }
    const local = getLocal();
    if (local.length > 0) pushBulkInsert(table, local.map(toRow));
  });

  supabase
    .channel(`${table}-sync`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => {
        if (payload.eventType === "DELETE") {
          const oldId = (payload.old as { id?: string } | null)?.id;
          if (oldId) applyDelete(oldId);
        } else {
          applyUpsert(fromRow(payload.new as TRow));
        }
      }
    )
    .subscribe();
}

// The initial fetch is a snapshot from whenever its query ran — if a local
// write (a brand-new row) landed in the gap between that snapshot and this
// resolving, it would otherwise vanish the instant applyInitial replaces
// local state with it. This is most likely right after a page load/reopen,
// while that fetch is still in flight and someone creates an order, a
// customer, a bill, etc. Every store's applyInitial should union its cloud
// result with whatever's local-only (not yet in the cloud snapshot) rather
// than blindly replacing — the next fetch or realtime event reconciles it
// properly once the cloud catches up (or a delete elsewhere removes it for
// real).
export function keepLocalOnly<T extends { id: string }>(cloudItems: T[], localItems: T[]): T[] {
  const cloudIds = new Set(cloudItems.map((i) => i.id));
  return localItems.filter((i) => !cloudIds.has(i.id));
}

function logError(action: string, table: string, error: unknown) {
  if (error) console.error(`[cloudSync] ${action} on "${table}" failed`, error);
}

// PostgREST's error for a column a migration hasn't added yet: "Could not
// find the 'x' column of 'table' in the schema cache" (code PGRST204).
// Naming the missing column, it's parseable — so instead of losing the
// *entire* row (insert/upsert is all-or-nothing; one unknown column fails
// the whole write), strip just that column and retry. The row still saves
// with whatever columns do exist, and picks the rest back up next time it's
// written after the migration runs — never data lost to a field that just
// hasn't landed in the cloud schema yet.
function missingColumn(message: string | undefined): string | null {
  const match = message ? /Could not find the '([^']+)' column/.exec(message) : null;
  return match ? match[1] : null;
}

// Every *WithRetry helper below returns whether the row actually reached
// the server — same reasoning as pushIncrement/pushUpdate: a dropped
// connection rejects the request instead of resolving it with an `error`
// field, so without a .catch() that rejection went unhandled and silent,
// making the write look "sent" from here even though the server never saw
// it. Callers that need to be sure a write landed (e.g. a customer merge —
// see useCustomersStore/useBillsStore) use the return value to know when
// to keep retrying instead of treating a fired request as done.
function insertWithRetry(table: string, row: Record<string, unknown>, action: string): Promise<boolean> {
  return Promise.resolve(supabase!.from(table).insert(row))
    .then(({ error }) => {
      if (!error) return true;
      const col = missingColumn(error.message);
      if (col && col in row) {
        const { [col]: _drop, ...rest } = row;
        return insertWithRetry(table, rest, action);
      }
      logError(action, table, error);
      return false;
    })
    .catch((error: unknown) => {
      logError(action, table, error);
      return false;
    });
}

function upsertWithRetry(table: string, row: Record<string, unknown>): Promise<boolean> {
  return Promise.resolve(supabase!.from(table).upsert(row))
    .then(({ error }) => {
      if (!error) return true;
      const col = missingColumn(error.message);
      if (col && col in row) {
        const { [col]: _drop, ...rest } = row;
        return upsertWithRetry(table, rest);
      }
      logError("upsert", table, error);
      return false;
    })
    .catch((error: unknown) => {
      logError("upsert", table, error);
      return false;
    });
}

function bulkInsertWithRetry(table: string, rows: Record<string, unknown>[]) {
  supabase!
    .from(table)
    .insert(rows)
    .then(({ error }) => {
      const col = missingColumn(error?.message);
      if (col) {
        // Strip the missing column from every row (they're all the same
        // shape here) rather than retrying one row at a time.
        bulkInsertWithRetry(
          table,
          rows.map((r) => {
            const rest = { ...r };
            delete rest[col];
            return rest;
          })
        );
      } else {
        logError("bulk insert (initial seed)", table, error);
      }
    });
}

export function pushBulkInsert<TRow extends object>(table: string, rows: TRow[]) {
  if (!supabase || rows.length === 0) return;
  bulkInsertWithRetry(table, rows as Record<string, unknown>[]);
}

function bulkUpsertWithRetry(table: string, rows: Record<string, unknown>[]) {
  supabase!
    .from(table)
    .upsert(rows)
    .then(({ error }) => {
      const col = missingColumn(error?.message);
      if (col) {
        bulkUpsertWithRetry(
          table,
          rows.map((r) => {
            const rest = { ...r };
            delete rest[col];
            return rest;
          })
        );
      } else {
        logError("bulk upsert (restore)", table, error);
      }
    });
}

export function pushInsert<TRow extends object>(table: string, row: TRow): Promise<boolean> {
  if (!supabase) return Promise.resolve(true);
  return insertWithRetry(table, row as Record<string, unknown>, "insert");
}

export function pushUpsert<TRow extends object>(table: string, row: TRow): Promise<boolean> {
  if (!supabase) return Promise.resolve(true);
  return upsertWithRetry(table, row as Record<string, unknown>);
}

// For a running counter (credit balance, stock quantity) that can get
// updated several times within milliseconds (e.g. billing a customer's
// three pending orders onto credit back to back) — pushUpsert sends each
// update as an absolute snapshot, and those requests can land at Supabase
// out of order over the network, leaving the row on some earlier, smaller
// value instead of the true final total. An atomic "+= delta" on the
// server can't lose updates that way regardless of arrival order, so use
// this for any field that's incremented/decremented rather than just set.
//
// Falls back to the old absolute-snapshot upsert if the increment function
// hasn't been created yet (see supabase/migration-atomic-counters.sql) —
// same "keep working before the migration runs" pattern as insertWithRetry.
//
// Returns whether the delta actually made it to the server. A dropped wifi
// connection (or any other network failure, not just a Postgrest-level
// error) rejects the request instead of resolving it with an `error` field —
// without a .catch() that rejection was going unhandled and silent, so the
// delta looked "sent" from here even though the server never saw it. The
// caller (useMenuStore's stock tracking) uses this to know when it needs to
// keep retrying rather than treat the local optimistic update as done.
export function pushIncrement<TRow extends object>(
  fn: string,
  args: Record<string, unknown>,
  fallbackTable: string,
  fallbackRow: TRow
): Promise<boolean> {
  if (!supabase) return Promise.resolve(true);
  return Promise.resolve(supabase.rpc(fn, args))
    .then(({ error }) => {
      if (!error) return true;
      if (/function .* does not exist/i.test(error.message ?? "")) {
        upsertWithRetry(fallbackTable, fallbackRow as Record<string, unknown>);
        return true;
      }
      logError(`rpc ${fn}`, fn, error);
      return false;
    })
    .catch((error: unknown) => {
      logError(`rpc ${fn}`, fn, error);
      return false;
    });
}

// A scoped column update — touches only the given fields, unlike pushUpsert
// which writes the whole row. Use this whenever a change only concerns a
// few fields unrelated to the rest of the row (e.g. reordering touches every
// table's sortOrder), so it can't clobber some other field a concurrent
// write on the same row just changed (e.g. a session someone just started
// on that table from another device).
//
// Returns whether the update actually reached the server, same reasoning
// as pushIncrement above — a dropped connection right when a table session
// gets stopped/paused/started must not look "sent" here when the server
// never got it, since a caller that tracks pending changes (useTablesStore)
// needs to know to keep retrying rather than treat it as done.
export function pushUpdate(table: string, id: string, patch: Record<string, unknown>): Promise<boolean> {
  if (!supabase) return Promise.resolve(true);
  return Promise.resolve(supabase.from(table).update(patch).eq("id", id))
    .then(({ error }) => {
      if (error) {
        logError("update", table, error);
        return false;
      }
      return true;
    })
    .catch((error: unknown) => {
      logError("update", table, error);
      return false;
    });
}

export function pushDelete(table: string, id: string): Promise<boolean> {
  if (!supabase) return Promise.resolve(true);
  return Promise.resolve(supabase.from(table).delete().eq("id", id))
    .then(({ error }) => {
      if (error) {
        logError("delete", table, error);
        return false;
      }
      return true;
    })
    .catch((error: unknown) => {
      logError("delete", table, error);
      return false;
    });
}

// Wipes every row in a cloud table — used by Settings → Reset All Data.
// `.neq("id", "")` is a no-op filter (no real id is ever an empty string)
// that matches every row, since PostgREST requires *some* filter on delete.
export function pushDeleteAll(table: string) {
  if (!supabase) return;
  supabase
    .from(table)
    .delete()
    .neq("id", "")
    .then(({ error }) => logError("delete all", table, error));
}
