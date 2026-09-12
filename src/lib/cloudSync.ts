import { supabase } from "./supabaseClient";

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

  supabase
    .from(table)
    .select("*")
    .then(({ data, error }) => {
      if (error) {
        console.error(`[cloudSync] initial fetch of "${table}" failed`, error);
        return;
      }
      if (data && data.length > 0) {
        applyInitial((data as TRow[]).map(fromRow));
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

function insertWithRetry(table: string, row: Record<string, unknown>, action: string) {
  supabase!
    .from(table)
    .insert(row)
    .then(({ error }) => {
      const col = missingColumn(error?.message);
      if (col && col in row) {
        const { [col]: _drop, ...rest } = row;
        insertWithRetry(table, rest, action);
      } else {
        logError(action, table, error);
      }
    });
}

function upsertWithRetry(table: string, row: Record<string, unknown>) {
  supabase!
    .from(table)
    .upsert(row)
    .then(({ error }) => {
      const col = missingColumn(error?.message);
      if (col && col in row) {
        const { [col]: _drop, ...rest } = row;
        upsertWithRetry(table, rest);
      } else {
        logError("upsert", table, error);
      }
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

export function pushInsert<TRow extends object>(table: string, row: TRow) {
  if (!supabase) return;
  insertWithRetry(table, row as Record<string, unknown>, "insert");
}

export function pushUpsert<TRow extends object>(table: string, row: TRow) {
  if (!supabase) return;
  upsertWithRetry(table, row as Record<string, unknown>);
}

export function pushDelete(table: string, id: string) {
  if (!supabase) return;
  supabase
    .from(table)
    .delete()
    .eq("id", id)
    .then(({ error }) => logError("delete", table, error));
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
