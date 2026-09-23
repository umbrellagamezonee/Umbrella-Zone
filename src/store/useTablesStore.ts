import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BillingTable, TableStatus } from "../types";
import { setupSync, pushInsert, pushUpdate, pushDelete, keepLocalOnly } from "../lib/cloudSync";

const DEFAULT_SESSION_MINUTES = 60;

function seedTable(name: string, kind: string, ratePerHour: number, sortOrder: number): BillingTable {
  return {
    id: crypto.randomUUID(),
    name,
    kind,
    ratePerHour,
    defaultSessionMinutes: DEFAULT_SESSION_MINUTES,
    status: "available",
    customerId: null,
    extraCustomerIds: [],
    activeGameId: null,
    sessionRatePerHour: null,
    sessionStartedAt: null,
    accumulatedMs: 0,
    plannedDurationMs: null,
    note: "",
    sortOrder,
  };
}

const seedTables: BillingTable[] = [
  seedTable("PS-4", "PlayStation", 120, 0),
  seedTable("PS-5", "PlayStation", 150, 1),
  seedTable("Pool 1", "Pool", 150, 2),
  seedTable("Pool 2", "Pool", 150, 3),
  seedTable("S2 1", "Snooker", 210, 4),
  seedTable("S2 2", "Snooker", 210, 5),
  seedTable("S1", "Snooker", 300, 6),
];

interface TableRow {
  id: string;
  name: string;
  kind: string;
  rate_per_hour: number;
  default_session_minutes: number;
  status: string;
  customer_id: string | null;
  extra_customer_ids: string[];
  active_game_id: string | null;
  session_rate_per_hour: number | null;
  session_started_at: string | null;
  accumulated_ms: number;
  planned_duration_ms: number | null;
  note: string;
  // Optional: only present once supabase/migration-table-order.sql has been
  // run. Missing (not just null) on any row fetched before that.
  sort_order?: number;
}

const TABLE = "billing_tables";
const fromRow = (row: TableRow): BillingTable => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  ratePerHour: Number(row.rate_per_hour),
  defaultSessionMinutes: row.default_session_minutes,
  status: row.status as TableStatus,
  customerId: row.customer_id,
  extraCustomerIds: row.extra_customer_ids ?? [],
  activeGameId: row.active_game_id,
  sessionRatePerHour: row.session_rate_per_hour != null ? Number(row.session_rate_per_hour) : null,
  sessionStartedAt: row.session_started_at ? new Date(row.session_started_at).getTime() : null,
  accumulatedMs: Number(row.accumulated_ms),
  plannedDurationMs: row.planned_duration_ms != null ? Number(row.planned_duration_ms) : null,
  note: row.note ?? "",
  // Falls back to this only when the fetch's row doesn't have sort_order
  // yet (migration not run) — an extreme value so an unplaced table sorts
  // to the very bottom instead of jumbling in among placed ones.
  sortOrder: row.sort_order ?? Number.MAX_SAFE_INTEGER,
});
const toRow = (t: BillingTable): TableRow => ({
  id: t.id,
  name: t.name,
  kind: t.kind,
  rate_per_hour: t.ratePerHour,
  default_session_minutes: t.defaultSessionMinutes,
  status: t.status,
  customer_id: t.customerId,
  extra_customer_ids: t.extraCustomerIds,
  active_game_id: t.activeGameId,
  session_rate_per_hour: t.sessionRatePerHour,
  session_started_at: t.sessionStartedAt ? new Date(t.sessionStartedAt).toISOString() : null,
  accumulated_ms: t.accumulatedMs,
  planned_duration_ms: t.plannedDurationMs,
  note: t.note,
  sort_order: t.sortOrder,
});

type NewTableInput = Pick<BillingTable, "name" | "kind" | "ratePerHour" | "note"> &
  Partial<Pick<BillingTable, "defaultSessionMinutes">>;

interface StartSessionOptions {
  gameId?: string | null;
  ratePerHour?: number | null;
  extraCustomerIds?: string[];
}

interface TablesState {
  tables: BillingTable[];
  addTable: (table: NewTableInput) => void;
  updateTable: (id: string, patch: Partial<BillingTable>) => void;
  // Nudges a table one place up or down in the manual display order. Local to
  // this device — renumbers every table's sortOrder 0..n-1 so ties can't build up.
  moveTable: (id: string, direction: "up" | "down") => void;
  removeTable: (id: string) => void;
  startSession: (id: string, customerId: string | null, opts?: StartSessionOptions) => void;
  addParticipant: (id: string, customerId: string) => void;
  pauseSession: (id: string) => void;
  resumeSession: (id: string) => void;
  stopSession: (id: string) => { elapsedMs: number };
}

function withDefaults(t: Partial<BillingTable> & { id: string; name: string }): BillingTable {
  return {
    kind: "PlayStation",
    ratePerHour: 0,
    defaultSessionMinutes: DEFAULT_SESSION_MINUTES,
    status: "available",
    customerId: null,
    extraCustomerIds: [],
    activeGameId: null,
    sessionRatePerHour: null,
    sessionStartedAt: null,
    accumulatedMs: 0,
    plannedDurationMs: null,
    note: "",
    sortOrder: 0,
    ...t,
  };
}

// Tables in the owner's chosen order (falls back to name so brand-new or
// freshly-synced tables sit predictably until placed).
export function orderedTables(tables: BillingTable[]): BillingTable[] {
  return [...tables].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

// Sends only the fields a session action actually changed, not this
// device's whole local copy of the table — same reasoning as moveTable's
// own pushUpdate below. Start/pause/resume/stop firing off pushTable's full
// pushUpsert meant that if this device's local state of the table was even
// slightly stale (a realtime update from another device/tab hadn't landed
// yet), acting on it would overwrite whatever that other device had just
// set — a session someone else started, or a pause that had already banked
// different elapsed time — with this device's outdated snapshot, silently
// and with no error. A scoped patch can only ever touch the handful of
// fields this exact action means to change.
function pushTablePatch(id: string, patch: Partial<BillingTable>) {
  const row: Partial<TableRow> = {};
  if ("status" in patch) row.status = patch.status;
  if ("customerId" in patch) row.customer_id = patch.customerId;
  if ("extraCustomerIds" in patch) row.extra_customer_ids = patch.extraCustomerIds;
  if ("activeGameId" in patch) row.active_game_id = patch.activeGameId;
  if ("sessionRatePerHour" in patch) row.session_rate_per_hour = patch.sessionRatePerHour;
  if ("sessionStartedAt" in patch)
    row.session_started_at = patch.sessionStartedAt ? new Date(patch.sessionStartedAt).toISOString() : null;
  if ("accumulatedMs" in patch) row.accumulated_ms = patch.accumulatedMs;
  if ("plannedDurationMs" in patch) row.planned_duration_ms = patch.plannedDurationMs;
  if ("note" in patch) row.note = patch.note;
  if ("name" in patch) row.name = patch.name;
  if ("kind" in patch) row.kind = patch.kind;
  if ("ratePerHour" in patch) row.rate_per_hour = patch.ratePerHour;
  if ("defaultSessionMinutes" in patch) row.default_session_minutes = patch.defaultSessionMinutes;
  pushUpdate(TABLE, id, row);
}

export const useTablesStore = create<TablesState>()(
  persist(
    (set, get) => ({
      tables: seedTables,

      addTable: (table) => {
        const maxOrder = get().tables.reduce((m, t) => Math.max(m, t.sortOrder), -1);
        const created = withDefaults({
          ...table,
          id: crypto.randomUUID(),
          defaultSessionMinutes: table.defaultSessionMinutes ?? DEFAULT_SESSION_MINUTES,
          sortOrder: maxOrder + 1,
        });
        set((state) => ({ tables: [...state.tables, created] }));
        pushInsert(TABLE, toRow(created));
      },

      updateTable: (id, patch) => {
        set((state) => ({
          tables: state.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }));
        pushTablePatch(id, patch);
      },

      moveTable: (id, direction) => {
        const ordered = orderedTables(get().tables);
        const idx = ordered.findIndex((t) => t.id === id);
        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) return;
        [ordered[idx], ordered[swapIdx]] = [ordered[swapIdx], ordered[idx]];
        const orderMap = new Map(ordered.map((t, i) => [t.id, i]));
        set((state) => ({
          tables: state.tables.map((t) => ({ ...t, sortOrder: orderMap.get(t.id) ?? t.sortOrder })),
        }));
        // Every table got renumbered above, not just the swapped pair — push
        // all of them so this order shows up the same on every device. Only
        // sortOrder, though (not the whole row) — otherwise this could
        // overwrite a session someone just started or stopped on an
        // unrelated table from another device with this device's stale
        // local copy of it (see pushTablePatch above for the same fix
        // applied to every session action).
        for (const t of get().tables) pushUpdate(TABLE, t.id, { sort_order: t.sortOrder });
      },

      removeTable: (id) => {
        set((state) => ({ tables: state.tables.filter((t) => t.id !== id) }));
        pushDelete(TABLE, id);
      },

      startSession: (id, customerId, opts) => {
        const table = get().tables.find((t) => t.id === id);
        if (!table) return;
        const patch: Partial<BillingTable> = {
          status: "running",
          customerId,
          extraCustomerIds: opts?.extraCustomerIds ?? [],
          activeGameId: opts?.gameId ?? null,
          sessionRatePerHour: opts?.ratePerHour ?? null,
          sessionStartedAt: Date.now(),
          accumulatedMs: 0,
          plannedDurationMs: table.defaultSessionMinutes * 60000,
        };
        set((state) => ({
          tables: state.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }));
        pushTablePatch(id, patch);
      },

      // Adds someone to an already-running/paused session (e.g. a friend joins
      // partway through). No-ops if they're already the primary or listed.
      addParticipant: (id, customerId) => {
        const table = get().tables.find((t) => t.id === id);
        if (!table || table.customerId === customerId || table.extraCustomerIds.includes(customerId)) return;
        const extraCustomerIds = [...table.extraCustomerIds, customerId];
        set((state) => ({
          tables: state.tables.map((t) => (t.id === id ? { ...t, extraCustomerIds } : t)),
        }));
        pushTablePatch(id, { extraCustomerIds });
      },

      pauseSession: (id) => {
        const table = get().tables.find((t) => t.id === id);
        if (!table || table.status !== "running" || !table.sessionStartedAt) return;
        const elapsed = Date.now() - table.sessionStartedAt;
        const patch: Partial<BillingTable> = {
          status: "paused",
          sessionStartedAt: null,
          accumulatedMs: table.accumulatedMs + elapsed,
        };
        set((state) => ({
          tables: state.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }));
        pushTablePatch(id, patch);
      },

      resumeSession: (id) => {
        const table = get().tables.find((t) => t.id === id);
        if (!table || table.status !== "paused") return;
        const patch: Partial<BillingTable> = { status: "running", sessionStartedAt: Date.now() };
        set((state) => ({
          tables: state.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }));
        pushTablePatch(id, patch);
      },

      stopSession: (id) => {
        const table = get().tables.find((t) => t.id === id);
        let elapsedMs = table?.accumulatedMs ?? 0;
        if (table?.status === "running" && table.sessionStartedAt) {
          elapsedMs += Date.now() - table.sessionStartedAt;
        }
        const patch: Partial<BillingTable> = {
          status: "available",
          customerId: null,
          extraCustomerIds: [],
          activeGameId: null,
          sessionRatePerHour: null,
          sessionStartedAt: null,
          accumulatedMs: 0,
          plannedDurationMs: null,
        };
        set((state) => ({
          tables: state.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }));
        pushTablePatch(id, patch);
        return { elapsedMs };
      },
    }),
    {
      name: "cuebill-tables",
      version: 6,
      migrate: (persisted) => {
        const state = persisted as {
          tables?: (Partial<BillingTable> & {
            id: string;
            name: string;
            ratePerMinute?: number;
          })[];
        };
        return {
          tables: (state.tables ?? []).map((t, i) => {
            const { ratePerMinute, ...rest } = t;
            return withDefaults({
              ...rest,
              ratePerHour: rest.ratePerHour ?? ratePerMinute ?? 0,
              // Seed the manual order from the position tables were already in.
              sortOrder: rest.sortOrder ?? i,
            });
          }),
        };
      },
    }
  )
);

// Merge safety for the window before supabase/migration-table-order.sql has
// been run: fromRow's fallback resolves a columnless fetch's sortOrder to
// Number.MAX_SAFE_INTEGER — keep whatever order this device already had for
// that table instead of losing it to a fetch that can't carry the real
// value yet. Once the migration lands, real values flow through normally
// and this stops doing anything.
function keepLocalSortOrder(incoming: BillingTable, local: BillingTable | undefined): BillingTable {
  return incoming.sortOrder === Number.MAX_SAFE_INTEGER && local
    ? { ...incoming, sortOrder: local.sortOrder }
    : incoming;
}

setupSync<TableRow, BillingTable>(
  TABLE,
  fromRow,
  toRow,
  () => useTablesStore.getState().tables,
  (tables) =>
    useTablesStore.setState((state) => {
      const byId = new Map(state.tables.map((t) => [t.id, t]));
      const maxLocal = state.tables.reduce((m, t) => Math.max(m, t.sortOrder), -1);
      const merged = tables.map((t, i) => {
        const m = keepLocalSortOrder(t, byId.get(t.id));
        // Neither this device nor the cloud has a real order for it — new
        // table, seed it in at the end instead of leaving the sentinel.
        return m.sortOrder === Number.MAX_SAFE_INTEGER ? { ...m, sortOrder: maxLocal + 1 + i } : m;
      });
      // A table added in the gap between this fetch starting and resolving
      // must not vanish — same reasoning as keepLocalOnly's own comment.
      // But seedTables (this store's built-in defaults) gives every table a
      // fresh random id on every module load, so a device that renders even
      // one frame before its first-ever cloud fetch resolves — no persisted
      // state yet, or storage was cleared — briefly has its own "Pool 1"
      // with an id the cloud has never seen. Once that happens it isn't a
      // one-time glitch: keepLocalOnly correctly treats it as "not yet
      // synced" and preserves it forever, so every table shows twice, on
      // every reload, permanently. Names are fixed and effectively unique
      // here (a handful of physical tables), so anything local-only whose
      // name a cloud table already has is that exact phantom, not a real
      // second table — drop it instead of keeping it.
      const mergedNames = new Set(merged.map((t) => t.name));
      const localOnly = keepLocalOnly(tables, state.tables).filter((t) => !mergedNames.has(t.name));
      return { tables: [...merged, ...localOnly] };
    }),
  (table) =>
    useTablesStore.setState((state) => {
      const existing = state.tables.find((t) => t.id === table.id);
      const maxLocal = state.tables.reduce((m, t) => Math.max(m, t.sortOrder), -1);
      let merged = keepLocalSortOrder(table, existing);
      if (merged.sortOrder === Number.MAX_SAFE_INTEGER) merged = { ...merged, sortOrder: maxLocal + 1 };
      return {
        tables: existing
          ? state.tables.map((t) => (t.id === table.id ? merged : t))
          : [...state.tables, merged],
      };
    }),
  (id) => useTablesStore.setState((state) => ({ tables: state.tables.filter((t) => t.id !== id) }))
);
