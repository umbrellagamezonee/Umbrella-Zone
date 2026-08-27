import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Expense } from "../types";

interface ExpensesState {
  expenses: Expense[];
  categories: string[];
  addExpense: (data: { category: string; amount: number; note: string }) => void;
  removeExpense: (id: string) => void;
}

export const useExpensesStore = create<ExpensesState>()(
  persist(
    (set) => ({
      expenses: [],
      categories: ["Supplies", "Maintenance", "Electricity", "Staff", "Other"],

      addExpense: (data) =>
        set((state) => ({
          expenses: [
            {
              id: crypto.randomUUID(),
              category: data.category,
              amount: data.amount,
              note: data.note,
              createdAt: Date.now(),
            },
            ...state.expenses,
          ],
        })),

      removeExpense: (id) =>
        set((state) => ({ expenses: state.expenses.filter((e) => e.id !== id) })),
    }),
    { name: "cuebill-expenses" }
  )
);
