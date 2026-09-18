import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Customer } from "../types";
import { cleanName, normalizeName } from "../lib/customerName";
import { syncCreditLedger } from "../lib/reminderApi";
import {
  setupSync,
  pushInsert,
  pushUpsert,
  pushIncrement,
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
  creditBalance: 0,
  lastReminderAt: null,
  createdAt: Date.now(),
};

interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  is_walk_in: boolean;
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
  creditBalance: Number(row.credit_balance),
  lastReminderAt: row.last_reminder_at ? new Date(row.last_reminder_at).getTime() : null,
  createdAt: new Date(row.created_at).getTime(),
});
const toRow = (c: Customer): CustomerRow => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  is_walk_in: c.isWalkIn,
  credit_balance: c.creditBalance,
  last_reminder_at: c.lastReminderAt ? new Date(c.lastReminderAt).toISOString() : null,
  created_at: new Date(c.createdAt).toISOString(),
});

interface CustomersState {
  customers: Customer[];
  addCustomer: (data: { name: string; phone: string; email: string }) => Customer;
  findOrCreateCustomer: (data: { name: string; phone: string }) => Customer;
  adjustCredit: (id: string, delta: number) => void;
  markReminded: (id: string) => void;
  removeCustomer: (id: string) => void;
  // Folds `sourceId` into `targetId`: the source's credit balance moves to the
  // target and the source profile is deleted. Rewriting the source's name off
  // any past bills is the caller's job (see useBillsStore.reassignCustomer).
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
          creditBalance: 0,
          lastReminderAt: null,
          createdAt: Date.now(),
        };
        set((state) => ({ customers: [...state.customers, customer] }));
        pushInsert(TABLE, toRow(customer));
        return customer;
      },

      // Phone is optional. If given and it matches an existing customer, that
      // profile wins. Otherwise falls back to matching by name (trimmed,
      // whitespace-collapsed, case-insensitive) so re-entering the same
      // person's name — however they capitalise or space it — reuses their
      // existing profile and credit balance instead of piling up duplicates.
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

      adjustCredit: (id, delta) => {
        set((state) => ({
          customers: state.customers.map((c) =>
            c.id === id ? { ...c, creditBalance: c.creditBalance + delta } : c
          ),
        }));
        const c = get().customers.find((x) => x.id === id);
        if (c) {
          syncCreditLedger({ customerId: c.id, name: c.name, phone: c.phone, amountDue: c.creditBalance });
          // An atomic "+= delta" on the server — several of these can fire
          // within the same second (e.g. billing a customer's whole pending
          // list onto credit) without any risk of one overwriting another.
          if (c.id !== "walk-in") pushIncrement("increment_credit_balance", { p_id: id, p_delta: delta }, TABLE, toRow(c));
        }
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
          creditBalance: target.creditBalance + source.creditBalance,
          // Keep whichever profile actually has contact details filled in.
          phone: target.phone || source.phone,
          email: target.email || source.email,
        };
        set((state) => ({
          customers: state.customers
            .filter((c) => c.id !== sourceId)
            .map((c) => (c.id === targetId ? merged : c)),
        }));
        syncCreditLedger({
          customerId: merged.id,
          name: merged.name,
          phone: merged.phone,
          amountDue: merged.creditBalance,
        });
        pushUpsert(TABLE, toRow(merged));
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
      version: 1,
      migrate: (persisted) => {
        const state = persisted as { customers?: (Partial<Customer> & { id: string })[] };
        return {
          customers: (state.customers ?? []).map((c) => ({
            id: c.id,
            name: c.name ?? "Guest",
            phone: c.phone ?? "",
            email: c.email ?? "",
            isWalkIn: c.isWalkIn ?? false,
            creditBalance: c.creditBalance ?? 0,
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
