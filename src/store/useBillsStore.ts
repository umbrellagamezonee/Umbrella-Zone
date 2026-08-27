import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Bill, BillCanteenItem, BillShare, PaymentMethod } from "../types";

interface ShareInput {
  label: string;
  payerName: string;
  amount: number;
}

interface CreateBillInput {
  tableId: string | null;
  tableName: string | null;
  orderId?: string | null;
  gameId: string | null;
  gameName: string | null;
  customerId: string | null;
  tableChargeMinutes: number;
  tableCharge: number;
  canteenCharge: number;
  canteenItems?: BillCanteenItem[];
  discount: number;
  shares?: ShareInput[];
}

interface SettleInput {
  method: PaymentMethod;
  amountPaid: number;
}

interface SettleShareInput {
  method: PaymentMethod;
  payerPhone?: string;
}

interface BillsState {
  bills: Bill[];
  // Soft-deleted bills, kept separately so every existing screen that reads
  // `bills` (Sessions, Reports, Home, Canteen) automatically stops seeing
  // them — no per-screen filtering needed.
  deletedBills: Bill[];
  createOpenBill: (input: CreateBillInput) => Bill;
  settlePayment: (id: string, input: SettleInput) => Bill | undefined;
  settleShare: (billId: string, shareId: string, input: SettleShareInput) => { bill: Bill; share: BillShare } | undefined;
  cancelBill: (id: string) => void;
  deleteBill: (id: string) => void;
  softDeleteBill: (id: string) => void;
  restoreBill: (id: string) => void;
  permanentlyDeleteBill: (id: string) => void;
  todaysBills: () => Bill[];
}

function isToday(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export const useBillsStore = create<BillsState>()(
  persist(
    (set, get) => ({
      bills: [],
      deletedBills: [],

      createOpenBill: (input) => {
        const gross = input.tableCharge + input.canteenCharge;
        const discount = Math.min(Math.max(0, input.discount), gross);
        const total = gross - discount;
        const shares: BillShare[] | null = input.shares
          ? input.shares.map((s) => ({
              id: crypto.randomUUID(),
              label: s.label,
              payerName: s.payerName,
              payerPhone: "",
              amount: s.amount,
              paymentMethod: null,
              status: "pending",
              paidAt: null,
            }))
          : null;
        const bill: Bill = {
          id: crypto.randomUUID(),
          tableId: input.tableId,
          tableName: input.tableName,
          orderId: input.orderId ?? null,
          gameId: input.gameId,
          gameName: input.gameName,
          customerId: input.customerId,
          tableChargeMinutes: input.tableChargeMinutes,
          tableCharge: input.tableCharge,
          canteenCharge: input.canteenCharge,
          canteenItems: input.canteenItems ?? [],
          discount,
          total,
          amountPaid: 0,
          amountDue: total,
          paymentMethod: null,
          shares,
          status: "open",
          createdAt: Date.now(),
          paidAt: null,
          deletedAt: null,
        };
        set((state) => ({ bills: [bill, ...state.bills] }));
        return bill;
      },

      settlePayment: (id, input) => {
        let updated: Bill | undefined;
        set((state) => ({
          bills: state.bills.map((b) => {
            if (b.id !== id) return b;
            const amountPaid = Math.min(Math.max(0, input.amountPaid), b.total);
            updated = {
              ...b,
              status: "paid",
              paymentMethod: input.method,
              amountPaid,
              amountDue: b.total - amountPaid,
              paidAt: Date.now(),
            };
            return updated;
          }),
        }));
        return updated;
      },

      settleShare: (billId, shareId, input) => {
        let result: { bill: Bill; share: BillShare } | undefined;
        set((state) => ({
          bills: state.bills.map((b) => {
            if (b.id !== billId || !b.shares) return b;
            const shares = b.shares.map((s) =>
              s.id === shareId
                ? {
                    ...s,
                    status: "paid" as const,
                    paymentMethod: input.method,
                    payerPhone: input.payerPhone ?? s.payerPhone,
                    paidAt: Date.now(),
                  }
                : s
            );
            const allPaid = shares.every((s) => s.status === "paid");
            const amountPaid = shares
              .filter((s) => s.status === "paid" && s.paymentMethod !== "credit")
              .reduce((sum, s) => sum + s.amount, 0);
            const amountDue = shares
              .filter((s) => s.status === "paid" && s.paymentMethod === "credit")
              .reduce((sum, s) => sum + s.amount, 0);
            const updated: Bill = {
              ...b,
              shares,
              amountPaid,
              amountDue,
              status: allPaid ? "paid" : "open",
              paidAt: allPaid ? Date.now() : b.paidAt,
            };
            result = { bill: updated, share: shares.find((s) => s.id === shareId)! };
            return updated;
          }),
        }));
        return result;
      },

      cancelBill: (id) =>
        set((state) => ({
          bills: state.bills.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b)),
        })),

      deleteBill: (id) => set((state) => ({ bills: state.bills.filter((b) => b.id !== id) })),

      // Moves a bill to the trash — hidden from Sessions/Reports/Home right
      // away, but recoverable from Settings → Deleted Bills until purged.
      softDeleteBill: (id) => {
        const bill = get().bills.find((b) => b.id === id);
        if (!bill) return;
        set((state) => ({
          bills: state.bills.filter((b) => b.id !== id),
          deletedBills: [{ ...bill, deletedAt: Date.now() }, ...state.deletedBills],
        }));
      },

      restoreBill: (id) => {
        const bill = get().deletedBills.find((b) => b.id === id);
        if (!bill) return;
        set((state) => ({
          deletedBills: state.deletedBills.filter((b) => b.id !== id),
          bills: [{ ...bill, deletedAt: null }, ...state.bills],
        }));
      },

      permanentlyDeleteBill: (id) =>
        set((state) => ({ deletedBills: state.deletedBills.filter((b) => b.id !== id) })),

      todaysBills: () => get().bills.filter((b) => isToday(b.createdAt)),
    }),
    {
      name: "cuebill-bills",
      version: 5,
      migrate: (persisted) => {
        const state = persisted as {
          bills?: (Partial<Bill> & { id: string; total: number })[];
          deletedBills?: (Partial<Bill> & { id: string; total: number })[];
        };
        const fill = (b: Partial<Bill> & { id: string; total: number }): Bill => ({
          id: b.id,
          tableId: b.tableId ?? null,
          tableName: b.tableName ?? null,
          orderId: b.orderId ?? null,
          gameId: b.gameId ?? null,
          gameName: b.gameName ?? null,
          customerId: b.customerId ?? null,
          tableChargeMinutes: b.tableChargeMinutes ?? 0,
          tableCharge: b.tableCharge ?? 0,
          canteenCharge: b.canteenCharge ?? 0,
          canteenItems: b.canteenItems ?? [],
          discount: b.discount ?? 0,
          total: b.total,
          amountPaid: b.amountPaid ?? (b.status === "paid" ? b.total : 0),
          amountDue: b.amountDue ?? (b.status === "paid" ? 0 : b.total),
          paymentMethod: b.paymentMethod ?? null,
          shares: b.shares ?? null,
          status: b.status ?? "open",
          createdAt: b.createdAt ?? Date.now(),
          paidAt: b.paidAt ?? null,
          deletedAt: b.deletedAt ?? null,
        });
        return {
          bills: (state.bills ?? []).map(fill),
          deletedBills: (state.deletedBills ?? []).map(fill),
        };
      },
    }
  )
);
