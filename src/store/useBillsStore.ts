import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Bill, BillCanteenItem, BillShare, PaymentMethod } from "../types";
import { setupSync, pushInsert, pushUpsert, pushDelete, pushDeleteAll } from "../lib/cloudSync";

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
  matchParticipants?: string[] | null;
  matchLosers?: string[] | null;
}

interface SettleInput {
  method: PaymentMethod;
  amountPaid: number;
}

interface SettleShareInput {
  method: PaymentMethod;
  payerPhone?: string;
}

interface BillRow {
  id: string;
  table_id: string | null;
  table_name: string | null;
  order_id: string | null;
  game_id: string | null;
  game_name: string | null;
  customer_id: string | null;
  table_charge_minutes: number;
  table_charge: number;
  canteen_charge: number;
  canteen_items: BillCanteenItem[];
  discount: number;
  total: number;
  amount_paid: number;
  amount_due: number;
  payment_method: string | null;
  shares: BillShare[] | null;
  status: string;
  created_at: string;
  paid_at: string | null;
  deleted_at: string | null;
  match_participants: string[] | null;
  match_losers: string[] | null;
}

const TABLE = "bills";
const fromRow = (row: BillRow): Bill => ({
  id: row.id,
  tableId: row.table_id,
  tableName: row.table_name,
  orderId: row.order_id,
  gameId: row.game_id,
  gameName: row.game_name,
  customerId: row.customer_id,
  tableChargeMinutes: Number(row.table_charge_minutes),
  tableCharge: Number(row.table_charge),
  canteenCharge: Number(row.canteen_charge),
  canteenItems: row.canteen_items ?? [],
  discount: Number(row.discount),
  total: Number(row.total),
  amountPaid: Number(row.amount_paid),
  amountDue: Number(row.amount_due),
  paymentMethod: row.payment_method as PaymentMethod | null,
  shares: row.shares,
  status: row.status as Bill["status"],
  createdAt: new Date(row.created_at).getTime(),
  paidAt: row.paid_at ? new Date(row.paid_at).getTime() : null,
  deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
  matchParticipants: row.match_participants ?? null,
  matchLosers: row.match_losers ?? null,
});
const toRow = (b: Bill): BillRow => ({
  id: b.id,
  table_id: b.tableId,
  table_name: b.tableName,
  order_id: b.orderId,
  game_id: b.gameId,
  game_name: b.gameName,
  customer_id: b.customerId,
  table_charge_minutes: b.tableChargeMinutes,
  table_charge: b.tableCharge,
  canteen_charge: b.canteenCharge,
  canteen_items: b.canteenItems,
  discount: b.discount,
  total: b.total,
  amount_paid: b.amountPaid,
  amount_due: b.amountDue,
  payment_method: b.paymentMethod,
  shares: b.shares,
  status: b.status,
  created_at: new Date(b.createdAt).toISOString(),
  paid_at: b.paidAt ? new Date(b.paidAt).toISOString() : null,
  deleted_at: b.deletedAt ? new Date(b.deletedAt).toISOString() : null,
  match_participants: b.matchParticipants,
  match_losers: b.matchLosers,
});

function pushBill(id: string) {
  const state = useBillsStore.getState();
  const b = state.bills.find((x) => x.id === id) ?? state.deletedBills.find((x) => x.id === id);
  if (b) pushUpsert(TABLE, toRow(b));
}

interface BillsState {
  bills: Bill[];
  // Soft-deleted bills, kept separately so every existing screen that reads
  // `bills` (Home, Reports, Canteen) automatically stops seeing
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
  resetAll: () => void;
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
          matchParticipants: input.matchParticipants ?? null,
          matchLosers: input.matchLosers ?? null,
        };
        set((state) => ({ bills: [bill, ...state.bills] }));
        pushInsert(TABLE, toRow(bill));
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
        if (updated) pushUpsert(TABLE, toRow(updated));
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
        if (result) pushUpsert(TABLE, toRow(result.bill));
        return result;
      },

      cancelBill: (id) => {
        set((state) => ({
          bills: state.bills.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b)),
        }));
        pushBill(id);
      },

      deleteBill: (id) => {
        set((state) => ({ bills: state.bills.filter((b) => b.id !== id) }));
        pushDelete(TABLE, id);
      },

      // Moves a bill to the trash — hidden from Home/Reports right
      // away, but recoverable from Settings → Deleted Bills until purged.
      softDeleteBill: (id) => {
        const bill = get().bills.find((b) => b.id === id);
        if (!bill) return;
        const deleted = { ...bill, deletedAt: Date.now() };
        set((state) => ({
          bills: state.bills.filter((b) => b.id !== id),
          deletedBills: [deleted, ...state.deletedBills],
        }));
        pushUpsert(TABLE, toRow(deleted));
      },

      restoreBill: (id) => {
        const bill = get().deletedBills.find((b) => b.id === id);
        if (!bill) return;
        const restored = { ...bill, deletedAt: null };
        set((state) => ({
          deletedBills: state.deletedBills.filter((b) => b.id !== id),
          bills: [restored, ...state.bills],
        }));
        pushUpsert(TABLE, toRow(restored));
      },

      permanentlyDeleteBill: (id) => {
        set((state) => ({ deletedBills: state.deletedBills.filter((b) => b.id !== id) }));
        pushDelete(TABLE, id);
      },

      todaysBills: () => get().bills.filter((b) => isToday(b.createdAt)),

      resetAll: () => {
        set({ bills: [], deletedBills: [] });
        pushDeleteAll(TABLE);
      },
    }),
    {
      name: "cuebill-bills",
      version: 7,
      migrate: (persisted) => {
        const state = persisted as {
          bills?: (Partial<Bill> & { id: string; total: number; matchLoser?: string | null })[];
          deletedBills?: (Partial<Bill> & { id: string; total: number; matchLoser?: string | null })[];
        };
        const fill = (b: Partial<Bill> & { id: string; total: number; matchLoser?: string | null }): Bill => ({
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
          matchParticipants: b.matchParticipants ?? null,
          // Old persisted bills only ever had a single `matchLoser` string —
          // wrap it into the new array shape instead of losing it.
          matchLosers: b.matchLosers ?? (b.matchLoser ? [b.matchLoser] : null),
        });
        return {
          bills: (state.bills ?? []).map(fill),
          deletedBills: (state.deletedBills ?? []).map(fill),
        };
      },
    }
  )
);

setupSync<BillRow, Bill>(
  TABLE,
  fromRow,
  toRow,
  () => [...useBillsStore.getState().bills, ...useBillsStore.getState().deletedBills],
  (allBills) => {
    useBillsStore.setState({
      bills: allBills.filter((b) => !b.deletedAt),
      deletedBills: allBills.filter((b) => !!b.deletedAt),
    });
  },
  (bill) =>
    useBillsStore.setState((state) => {
      const bills = state.bills.filter((b) => b.id !== bill.id);
      const deletedBills = state.deletedBills.filter((b) => b.id !== bill.id);
      return bill.deletedAt
        ? { bills, deletedBills: [bill, ...deletedBills] }
        : { bills: [bill, ...bills], deletedBills };
    }),
  (id) =>
    useBillsStore.setState((state) => ({
      bills: state.bills.filter((b) => b.id !== id),
      deletedBills: state.deletedBills.filter((b) => b.id !== id),
    }))
);
