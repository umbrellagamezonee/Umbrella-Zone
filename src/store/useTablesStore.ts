import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BillingTable, TableStatus } from "../types";
import { setupSync, pushInsert, pushUpsert, pushDelete } from "../lib/cloudSync";

const DEFAULT_SESSION_MINUTES = 60;

function seedTable(name: string, kind: string, ratePerHour: number): BillingTable {
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
  };
}

const seedTables: BillingTable[] = [
  seedTable("PS-4", "PlayStation", 120),
  seedTable("PS-5", "PlayStation", 150),
  seedTable("Pool 1", "Pool", 150),
  seedTable("Pool 2", "Pool", 150),
  seedTable("S2 1", "Snooker", 210),
  seedTable("S2 2", "Snooker", 210),
  seedTable("S1", "Snooker", 300),
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
    ...t,
  };
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
        const created = withDefaults({
          ...table,
          id: crypto.randomUUID(),
          defaultSessionMinutes: table.defaultSessionMinutes ?? DEFAULT_SESSION_MINUTES,
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
      version: 4,
      migrate: (persisted) => {
        const state = persisted as {
          tables?: (Partial<BillingTable> & {
            id: string;
            name: string;
            ratePerMinute?: number;
          })[];
        };
        return {
          tables: (state.tables ?? []).map((t) => {
            const { ratePerMinute, ...rest } = t;
            return withDefaults({
              ...rest,
              ratePerHour: rest.ratePerHour ?? ratePerMinute ?? 0,
            });
          }),
        };
      },
    }
  )
);

setupSync<TableRow, BillingTable>(
  TABLE,
  fromRow,
  toRow,
  () => useTablesStore.getState().tables,
  (tables) => useTablesStore.setState({ tables }),
  (table) =>
    useTablesStore.setState((state) => {
      const exists = state.tables.some((t) => t.id === table.id);
      return {
        tables: exists
          ? state.tables.map((t) => (t.id === table.id ? table : t))
          : [...state.tables, table],
      };
    }),
  (id) => useTablesStore.setState((state) => ({ tables: state.tables.filter((t) => t.id !== id) }))
);
