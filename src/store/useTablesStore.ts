import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BillingTable, TableStatus } from "../types";
import { setupSync, pushInsert, pushUpsert, pushDelete } from "../lib/cloudSync";

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
  // Display order is a per-device preference, not stored in the cloud — a
  // freshly-synced table drops to the bottom until this device places it,
  // and the real value is merged back in by the sync handlers below.
  sortOrder: Number.MAX_SAFE_INTEGER,
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

// Every action below ends by re-reading the table it just touched and
// pushing that full row to Supabase — simpler and less error-prone than
// hand-building a partial patch per action.
function pushTable(id: string) {
  const t = useTablesStore.getState().tables.find((x) => x.id === id);
  if (t) pushUpsert(TABLE, toRow(t));
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
        pushTable(id);
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
        // Local-only: display order isn't pushed to the cloud.
      },

      removeTable: (id) => {
        set((state) => ({ tables: state.tables.filter((t) => t.id !== id) }));
        pushDelete(TABLE, id);
      },

      startSession: (id, customerId, opts) => {
        set((state) => ({
          tables: state.tables.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: "running",
                  customerId,
                  extraCustomerIds: opts?.extraCustomerIds ?? [],
                  activeGameId: opts?.gameId ?? null,
                  sessionRatePerHour: opts?.ratePerHour ?? null,
                  sessionStartedAt: Date.now(),
                  accumulatedMs: 0,
                  plannedDurationMs: t.defaultSessionMinutes * 60000,
                }
              : t
          ),
        }));
        pushTable(id);
      },

      // Adds someone to an already-running/paused session (e.g. a friend joins
      // partway through). No-ops if they're already the primary or listed.
      addParticipant: (id, customerId) => {
        set((state) => ({
          tables: state.tables.map((t) => {
            if (t.id !== id) return t;
            if (t.customerId === customerId || t.extraCustomerIds.includes(customerId)) return t;
            return { ...t, extraCustomerIds: [...t.extraCustomerIds, customerId] };
          }),
        }));
        pushTable(id);
      },

      pauseSession: (id) => {
        set((state) => ({
          tables: state.tables.map((t) => {
            if (t.id !== id || t.status !== "running" || !t.sessionStartedAt) return t;
            const elapsed = Date.now() - t.sessionStartedAt;
            return {
              ...t,
              status: "paused",
              sessionStartedAt: null,
              accumulatedMs: t.accumulatedMs + elapsed,
            };
          }),
        }));
        pushTable(id);
      },

      resumeSession: (id) => {
        set((state) => ({
          tables: state.tables.map((t) =>
            t.id === id && t.status === "paused"
              ? { ...t, status: "running", sessionStartedAt: Date.now() }
              : t
          ),
        }));
        pushTable(id);
      },

      stopSession: (id) => {
        const table = get().tables.find((t) => t.id === id);
        let elapsedMs = table?.accumulatedMs ?? 0;
        if (table?.status === "running" && table.sessionStartedAt) {
          elapsedMs += Date.now() - table.sessionStartedAt;
        }
        set((state) => ({
          tables: state.tables.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: "available",
                  customerId: null,
                  extraCustomerIds: [],
                  activeGameId: null,
                  sessionRatePerHour: null,
                  sessionStartedAt: null,
                  accumulatedMs: 0,
                  plannedDurationMs: null,
                }
              : t
          ),
        }));
        pushTable(id);
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

// sortOrder never comes from the cloud, so every sync handler keeps whatever
// order this device already had for a table it knows, and drops a genuinely
// new one at the bottom.
setupSync<TableRow, BillingTable>(
  TABLE,
  fromRow,
  toRow,
  () => useTablesStore.getState().tables,
  (tables) =>
    useTablesStore.setState((state) => {
      const localOrder = new Map(state.tables.map((t) => [t.id, t.sortOrder]));
      const maxLocal = state.tables.reduce((m, t) => Math.max(m, t.sortOrder), -1);
      return {
        tables: tables.map((t, i) => ({
          ...t,
          sortOrder: localOrder.get(t.id) ?? maxLocal + 1 + i,
        })),
      };
    }),
  (table) =>
    useTablesStore.setState((state) => {
      const existing = state.tables.find((t) => t.id === table.id);
      const maxLocal = state.tables.reduce((m, t) => Math.max(m, t.sortOrder), -1);
      const merged = { ...table, sortOrder: existing ? existing.sortOrder : maxLocal + 1 };
      return {
        tables: existing
          ? state.tables.map((t) => (t.id === table.id ? merged : t))
          : [...state.tables, merged],
      };
    }),
  (id) => useTablesStore.setState((state) => ({ tables: state.tables.filter((t) => t.id !== id) }))
);
