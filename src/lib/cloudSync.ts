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

export function pushBulkInsert<TRow extends object>(table: string, rows: TRow[]) {
  if (!supabase || rows.length === 0) return;
  supabase
    .from(table)
    .insert(rows)
    .then(({ error }) => logError("bulk insert (initial seed)", table, error));
}

export function pushInsert<TRow extends object>(table: string, row: TRow) {
  if (!supabase) return;
  supabase
    .from(table)
    .insert(row)
    .then(({ error }) => logError("insert", table, error));
}

export function pushUpsert<TRow extends object>(table: string, row: TRow) {
  if (!supabase) return;
  supabase
    .from(table)
    .upsert(row)
    .then(({ error }) => logError("upsert", table, error));
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
