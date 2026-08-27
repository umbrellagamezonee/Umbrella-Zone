import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Customer } from "../types";
import { syncCreditLedger } from "../lib/reminderApi";

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

interface CustomersState {
  customers: Customer[];
  addCustomer: (data: { name: string; phone: string; email: string }) => Customer;
  findOrCreateCustomer: (data: { name: string; phone: string }) => Customer;
  adjustCredit: (id: string, delta: number) => void;
  markReminded: (id: string) => void;
  removeCustomer: (id: string) => void;
}

export const useCustomersStore = create<CustomersState>()(
  persist(
    (set, get) => ({
      customers: [walkIn],

      addCustomer: (data) => {
        const customer: Customer = {
          id: crypto.randomUUID(),
          name: data.name,
          phone: data.phone,
          email: data.email,
          isWalkIn: false,
          creditBalance: 0,
          lastReminderAt: null,
          createdAt: Date.now(),
        };
        set((state) => ({ customers: [...state.customers, customer] }));
        return customer;
      },

      // Phone is optional. If given and it matches an existing customer, that
      // profile wins. Otherwise falls back to matching by name (trimmed,
      // case-insensitive) so re-entering the same person's name reuses their
      // existing profile and credit balance instead of creating a duplicate.
      findOrCreateCustomer: (data) => {
        const phone = data.phone.trim();
        const name = data.name.trim();
        if (phone) {
          const byPhone = get().customers.find((c) => !c.isWalkIn && c.phone === phone);
          if (byPhone) return byPhone;
        }
        if (name) {
          const lower = name.toLowerCase();
          const byName = get().customers.find((c) => !c.isWalkIn && c.name.trim().toLowerCase() === lower);
          if (byName) return byName;
        }
        return get().addCustomer({ name: name || "Guest", phone, email: "" });
      },

      adjustCredit: (id, delta) => {
        set((state) => ({
          customers: state.customers.map((c) =>
            c.id === id ? { ...c, creditBalance: c.creditBalance + delta } : c
          ),
        }));
        const c = get().customers.find((x) => x.id === id);
        if (c) syncCreditLedger({ customerId: c.id, name: c.name, phone: c.phone, amountDue: c.creditBalance });
      },

      markReminded: (id) =>
        set((state) => ({
          customers: state.customers.map((c) =>
            c.id === id ? { ...c, lastReminderAt: Date.now() } : c
          ),
        })),

      removeCustomer: (id) =>
        set((state) => ({ customers: state.customers.filter((c) => c.id !== id) })),
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
