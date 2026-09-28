import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Customer } from "../types";
import { cleanName, normalizeName } from "../lib/customerName";
import {
  setupSync,
  pushInsert,
  pushUpsert,
  pushUpdate,
  pushDelete,
  pushDeleteAll,
  keepLocalOnly,
} from "../lib/cloudSync";
import { useBillsStore, pushBillById } from "./useBillsStore";

const walkIn: Customer = {
  id: "walk-in",
  name: "Walk-in",
  phone: "",
  email: "",
  isWalkIn: true,
  lastReminderAt: null,
  createdAt: Date.now(),
};

interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  is_walk_in: boolean;
  // Column still exists in Supabase (a real migration to drop it isn't
  // worth the risk) but the app never reads it back — what a customer owes
  // is always computed fresh from their bills (see creditBalanceFor in
  // lib/billing.ts). Always written as 0 so no old reader is misled by it.
  credit_balance: number;
  last_reminder_at: string | null;
  created_at: string;
}

// "walk-in" is a fixed local sentinel (not a real uuid) — it's never a row
// in the cloud table, every device just keeps its own copy of it.
const TABLE = "customers";
const fromRow = (row: CustomerRow): Customer => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  isWalkIn: row.is_walk_in,
  lastReminderAt: row.last_reminder_at ? new Date(row.last_reminder_at).getTime() : null,
  createdAt: new Date(row.created_at).getTime(),
});
const toRow = (c: Customer): CustomerRow => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  is_walk_in: c.isWalkIn,
  credit_balance: 0,
  last_reminder_at: c.lastReminderAt ? new Date(c.lastReminderAt).toISOString() : null,
  created_at: new Date(c.createdAt).toISOString(),
});

// A merge not yet fully confirmed saved to the cloud — see
// mergeCustomerSafely below. billIds are the specific bills
// reassignCustomer touched, kept so a retry can re-push exactly those
// (reading their current, already-locally-corrected data) without having
// to re-derive "which bills belong to this merge" after the source
// customer id has already stopped appearing anywhere locally.
interface PendingMerge {
  targetId: string;
  targetName: string;
  billIds: string[];
}

interface CustomersState {
  customers: Customer[];
  pendingMerges: Record<string, PendingMerge>;
  addCustomer: (data: { name: string; phone: string; email: string }) => Customer;
  findOrCreateCustomer: (data: { name: string; phone: string }) => Customer;
  updateCustomer: (id: string, patch: { name?: string; phone?: string; email?: string }) => void;
  markReminded: (id: string) => void;
  removeCustomer: (id: string) => void;
  // Deletes the source profile — what it's owed moves to the target
  // automatically the moment useBillsStore.reassignCustomer rewrites its
  // bills onto the target's id/name, since credit is always computed fresh
  // from bills rather than carried as a number on the customer record.
  // Only applies locally and makes one attempt at saving to the cloud —
  // use mergeCustomerSafely (below) to actually merge, which wraps this
  // with the same retry-until-confirmed handling as the rest of today's
  // fixes.
  mergeCustomer: (sourceId: string, targetId: string) => Promise<boolean>;
  // Merges sourceId into targetId and keeps retrying (bill reassignment +
  // the customer update/delete) until the cloud actually confirms every
  // part — a merge that only half-lands (e.g. the connection drops right
  // after the local UI updates) would otherwise leave both profiles
  // sitting in Supabase, still separate, with no error shown to anyone.
  mergeCustomerSafely: (sourceId: string, sourceName: string, targetId: string, targetName: string) => void;
  resetAll: () => void;
}

export const useCustomersStore = create<CustomersState>()(
  persist(
    (set, get) => ({
      customers: [walkIn],
      pendingMerges: {},

      addCustomer: (data) => {
        const customer: Customer = {
          id: crypto.randomUUID(),
          name: cleanName(data.name),
          phone: data.phone,
          email: data.email,
          isWalkIn: false,
          lastReminderAt: null,
          createdAt: Date.now(),
        };
        set((state) => ({ customers: [...state.customers, customer] }));
        pushInsert(TABLE, toRow(customer));
        return customer;
      },

      updateCustomer: (id, patch) => {
        set((state) => ({
          customers: state.customers.map((c) =>
            c.id === id
              ? {
                  ...c,
                  ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}),
                  ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
                  ...(patch.email !== undefined ? { email: patch.email } : {}),
                }
              : c
          ),
        }));
        const c = get().customers.find((x) => x.id === id);
        if (c && c.id !== "walk-in") pushUpsert(TABLE, toRow(c));
      },

      // Phone is optional. If given and it matches an existing customer, that
      // profile wins. Otherwise falls back to matching by name (trimmed,
      // whitespace-collapsed, case-insensitive) so re-entering the same
      // person's name — however they capitalise or space it — reuses their
      // existing profile and credit history instead of piling up duplicates.
      findOrCreateCustomer: (data) => {
        const phone = data.phone.trim();
        const key = normalizeName(data.name);
        if (phone) {
          const byPhone = get().customers.find((c) => !c.isWalkIn && c.phone === phone);
          if (byPhone) return byPhone;
        }
        if (key) {
          const byName = get().customers.find((c) => !c.isWalkIn && normalizeName(c.name) === key);
          if (byName) return byName;
        }
        return get().addCustomer({ name: cleanName(data.name) || "Guest", phone, email: "" });
      },

      markReminded: (id) => {
        set((state) => ({
          customers: state.customers.map((c) =>
            c.id === id ? { ...c, lastReminderAt: Date.now() } : c
          ),
        }));
        const c = get().customers.find((x) => x.id === id);
        if (c && c.id !== "walk-in") pushUpsert(TABLE, toRow(c));
      },

      removeCustomer: (id) => {
        set((state) => ({ customers: state.customers.filter((c) => c.id !== id) }));
        if (id !== "walk-in") pushDelete(TABLE, id);
      },

      mergeCustomer: (sourceId, targetId) => {
        if (sourceId === targetId || sourceId === "walk-in" || targetId === "walk-in") return Promise.resolve(true);
        const source = get().customers.find((c) => c.id === sourceId);
        const target = get().customers.find((c) => c.id === targetId);
        if (!source || !target) return Promise.resolve(true);
        const merged: Customer = {
          ...target,
          // Keep whichever profile actually has contact details filled in.
          phone: target.phone || source.phone,
          email: target.email || source.email,
        };
        set((state) => ({
          customers: state.customers
            .filter((c) => c.id !== sourceId)
            .map((c) => (c.id === targetId ? merged : c)),
        }));
        return Promise.all([
          pushUpdate(TABLE, targetId, { phone: merged.phone, email: merged.email }),
          pushDelete(TABLE, sourceId),
        ]).then(([updateOk, deleteOk]) => updateOk && deleteOk);
      },

      mergeCustomerSafely: (sourceId, sourceName, targetId, targetName) => {
        useBillsStore
          .getState()
          .reassignCustomer(sourceId, sourceName, targetId, targetName)
          .then(({ ok: billsOk, billIds }) =>
            get()
              .mergeCustomer(sourceId, targetId)
              .then((customerOk) => {
                if (billsOk && customerOk) return;
                set((state) => ({
                  pendingMerges: { ...state.pendingMerges, [sourceId]: { targetId, targetName, billIds } },
                }));
                retryPendingMerge(sourceId);
              })
          );
      },

      // Keeps the "walk-in" sentinel (never a real cloud row) and wipes
      // everyone else.
      resetAll: () => {
        set({ customers: [walkIn], pendingMerges: {} });
        pushDeleteAll(TABLE);
      },
    }),
    {
      name: "cuebill-customers",
      version: 2,
      migrate: (persisted) => {
        const state = persisted as { customers?: (Partial<Customer> & { id: string })[] };
        return {
          customers: (state.customers ?? []).map((c) => ({
            id: c.id,
            name: c.name ?? "Guest",
            phone: c.phone ?? "",
            email: c.email ?? "",
            isWalkIn: c.isWalkIn ?? false,
            lastReminderAt: c.lastReminderAt ?? null,
            createdAt: c.createdAt ?? Date.now(),
          })),
        };
      },
    }
  )
);

// In-flight guard so a merge already being retried isn't retried twice at
// once by a concurrent flush.
const mergeRetryInFlight = new Set<string>();

// Re-pushes exactly what a pending merge still needs: each reassigned
// bill (read fresh from useBillsStore, which already has the correct
// customer id locally regardless of whether the earlier push succeeded),
// the target's contact details, and the source's delete — the last two
// via mergeCustomer, which is safe to call again since deleting an
// already-deleted row, or upserting the same phone/email, is a no-op
// either way. Only clears the pending entry once every part is confirmed.
function retryPendingMerge(sourceId: string) {
  if (mergeRetryInFlight.has(sourceId)) return;
  const pending = useCustomersStore.getState().pendingMerges[sourceId];
  if (!pending) return;
  mergeRetryInFlight.add(sourceId);
  Promise.all([
    ...pending.billIds.map((id) => pushBillById(id)),
    useCustomersStore.getState().mergeCustomer(sourceId, pending.targetId),
  ]).then((results) => {
    mergeRetryInFlight.delete(sourceId);
    if (!results.every(Boolean)) return;
    useCustomersStore.setState((state) => {
      const rest = { ...state.pendingMerges };
      delete rest[sourceId];
      return { pendingMerges: rest };
    });
  });
}

function flushPendingMerges() {
  for (const sourceId of Object.keys(useCustomersStore.getState().pendingMerges)) retryPendingMerge(sourceId);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", flushPendingMerges);
  setInterval(flushPendingMerges, 30_000);
}

setupSync<CustomerRow, Customer>(
  TABLE,
  fromRow,
  toRow,
  () => useCustomersStore.getState().customers.filter((c) => c.id !== "walk-in"),
  // A customer profile created in the gap between this fetch starting and
  // resolving (e.g. typing a name for a new order right after reload) must
  // not vanish — losing it here is exactly what makes that order fall back
  // to showing "Walk-in" (its customerId no longer resolves to anyone).
  (customers) => {
    useCustomersStore.setState((state) => ({
      // A source customer whose delete hasn't confirmed yet would
      // otherwise reappear here the moment a fresh fetch pulls its still-
      // present cloud row back in — drop it again locally; the retry above
      // is already working on actually deleting it.
      customers: [
        walkIn,
        ...customers.filter((c) => !(c.id in useCustomersStore.getState().pendingMerges)),
        ...keepLocalOnly(customers, state.customers.filter((c) => c.id !== "walk-in")),
      ],
    }));
    flushPendingMerges();
  },
  (customer) =>
    useCustomersStore.setState((state) => {
      if (customer.id in state.pendingMerges) return {};
      const exists = state.customers.some((c) => c.id === customer.id);
      return {
        customers: exists
          ? state.customers.map((c) => (c.id === customer.id ? customer : c))
          : [...state.customers, customer],
      };
    }),
  (id) =>
    useCustomersStore.setState((state) => ({ customers: state.customers.filter((c) => c.id !== id) }))
);
