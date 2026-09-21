import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Expense } from "../types";
import { setupSync, pushInsert, pushDelete, pushDeleteAll, keepLocalOnly } from "../lib/cloudSync";

interface ExpenseRow {
  id: string;
  category: string;
  amount: number;
  note: string;
  created_at: string;
}

const TABLE = "expenses";
const fromRow = (row: ExpenseRow): Expense => ({
  id: row.id,
  category: row.category,
  amount: Number(row.amount),
  note: row.note,
  createdAt: new Date(row.created_at).getTime(),
});
const toRow = (e: Expense): ExpenseRow => ({
  id: e.id,
  category: e.category,
  amount: e.amount,
  note: e.note,
  created_at: new Date(e.createdAt).toISOString(),
});

interface ExpensesState {
  expenses: Expense[];
  categories: string[];
  addExpense: (data: { category: string; amount: number; note: string }) => void;
  removeExpense: (id: string) => void;
  resetAll: () => void;
}

export const useExpensesStore = create<ExpensesState>()(
  persist(
    (set) => ({
      expenses: [],
      categories: [
        "Table",
        "Food",
        "Drinks",
        "Cigarette",
        "Chocolate",
        "Supplies",
        "Maintenance",
        "Electricity",
        "Staff",
        "Other",
      ],

      addExpense: (data) => {
        const created: Expense = {
          id: crypto.randomUUID(),
          category: data.category,
          amount: data.amount,
          note: data.note,
          createdAt: Date.now(),
        };
        set((state) => ({ expenses: [created, ...state.expenses] }));
        pushInsert(TABLE, toRow(created));
      },

      removeExpense: (id) => {
        set((state) => ({ expenses: state.expenses.filter((e) => e.id !== id) }));
        pushDelete(TABLE, id);
      },

      resetAll: () => {
        set({ expenses: [] });
        pushDeleteAll(TABLE);
      },
    }),
    {
      name: "cuebill-expenses",
      version: 1,
      // v1: added Table/Food/Drinks/Cigarette/Chocolate ahead of the
      // original list, for the monthly business report — a device that
      // already persisted the old category list otherwise keeps it forever,
      // never picking up the new ones.
      migrate: (persisted, version) => {
        const state = persisted as ExpensesState;
        if (version >= 1) return state;
        const newOnes = ["Table", "Food", "Drinks", "Cigarette", "Chocolate"];
        return {
          ...state,
          categories: [...newOnes, ...(state.categories ?? []).filter((c) => !newOnes.includes(c))],
        };
      },
    }
  )
);

setupSync<ExpenseRow, Expense>(
  TABLE,
  fromRow,
  toRow,
  () => useExpensesStore.getState().expenses,
  (expenses) =>
    useExpensesStore.setState((state) => ({
      expenses: [...expenses, ...keepLocalOnly(expenses, state.expenses)].sort(
        (a, b) => b.createdAt - a.createdAt
      ),
    })),
  (expense) =>
    useExpensesStore.setState((state) => {
      const exists = state.expenses.some((e) => e.id === expense.id);
      const expenses = exists
        ? state.expenses.map((e) => (e.id === expense.id ? expense : e))
        : [expense, ...state.expenses];
      return { expenses: expenses.sort((a, b) => b.createdAt - a.createdAt) };
    }),
  (id) => useExpensesStore.setState((state) => ({ expenses: state.expenses.filter((e) => e.id !== id) }))
);
