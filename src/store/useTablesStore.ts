import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BillingTable } from "../types";

const DEFAULT_SESSION_MINUTES = 60;

const seedTables: BillingTable[] = [
  {
    id: crypto.randomUUID(),
    name: "PlayStation 1",
    kind: "PlayStation",
    ratePerHour: 60,
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
  },
  {
    id: crypto.randomUUID(),
    name: "PlayStation 2",
    kind: "PlayStation",
    ratePerHour: 60,
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
  },
];

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

export const useTablesStore = create<TablesState>()(
  persist(
    (set, get) => ({
      tables: seedTables,

      addTable: (table) =>
        set((state) => ({
          tables: [
            ...state.tables,
            withDefaults({
              ...table,
              id: crypto.randomUUID(),
              defaultSessionMinutes: table.defaultSessionMinutes ?? DEFAULT_SESSION_MINUTES,
            }),
          ],
        })),

      updateTable: (id, patch) =>
        set((state) => ({
          tables: state.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),

      removeTable: (id) =>
        set((state) => ({ tables: state.tables.filter((t) => t.id !== id) })),

      startSession: (id, customerId, opts) =>
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
        })),

      // Adds someone to an already-running/paused session (e.g. a friend joins
      // partway through). No-ops if they're already the primary or listed.
      addParticipant: (id, customerId) =>
        set((state) => ({
          tables: state.tables.map((t) => {
            if (t.id !== id) return t;
            if (t.customerId === customerId || t.extraCustomerIds.includes(customerId)) return t;
            return { ...t, extraCustomerIds: [...t.extraCustomerIds, customerId] };
          }),
        })),

      pauseSession: (id) =>
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
        })),

      resumeSession: (id) =>
        set((state) => ({
          tables: state.tables.map((t) =>
            t.id === id && t.status === "paused"
              ? { ...t, status: "running", sessionStartedAt: Date.now() }
              : t
          ),
        })),

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
