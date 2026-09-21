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

interface CustomersState {
  customers: Customer[];
  addCustomer: (data: { name: string; phone: string; email: string }) => Customer;
  findOrCreateCustomer: (data: { name: string; phone: string }) => Customer;
  updateCustomer: (id: string, patch: { name?: string; phone?: string; email?: string }) => void;
  markReminded: (id: string) => void;
  removeCustomer: (id: string) => void;
  // Deletes the source profile — what it's owed moves to the target
  // automatically the moment useBillsStore.reassignCustomer rewrites its
  // bills onto the target's id/name, since credit is always computed fresh
  // from bills rather than carried as a number on the customer record.
  mergeCustomer: (sourceId: string, targetId: string) => void;
  resetAll: () => void;
}

export const useCustomersStore = create<CustomersState>()(
  persist(
    (set, get) => ({
      customers: [walkIn],

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
        if (sourceId === targetId || sourceId === "walk-in" || targetId === "walk-in") return;
        const source = get().customers.find((c) => c.id === sourceId);
        const target = get().customers.find((c) => c.id === targetId);
        if (!source || !target) return;
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
        pushUpdate(TABLE, targetId, { phone: merged.phone, email: merged.email });
        pushDelete(TABLE, sourceId);
      },

      // Keeps the "walk-in" sentinel (never a real cloud row) and wipes
      // everyone else.
      resetAll: () => {
        set({ customers: [walkIn] });
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

setupSync<CustomerRow, Customer>(
  TABLE,
  fromRow,
  toRow,
  () => useCustomersStore.getState().customers.filter((c) => c.id !== "walk-in"),
  // A customer profile created in the gap between this fetch starting and
  // resolving (e.g. typing a name for a new order right after reload) must
  // not vanish — losing it here is exactly what makes that order fall back
  // to showing "Walk-in" (its customerId no longer resolves to anyone).
  (customers) =>
    useCustomersStore.setState((state) => ({
      customers: [
        walkIn,
        ...customers,
        ...keepLocalOnly(customers, state.customers.filter((c) => c.id !== "walk-in")),
      ],
    })),
  (customer) =>
    useCustomersStore.setState((state) => {
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
