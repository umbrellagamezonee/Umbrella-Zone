import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Bill, BillCanteenItem, BillShare, PaymentMethod } from "../types";
import { setupSync, pushInsert, pushUpsert, pushDelete, pushDeleteAll, keepLocalOnly } from "../lib/cloudSync";
import { useOrdersStore } from "./useOrdersStore";
import { isToday } from "../lib/format";

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

// A payer can split what they hand over between cash and account (UPI/bank
// transfer) — whatever's left of the total after both becomes credit.
interface SettleInput {
  amountCash: number;
  amountUpi: number;
}

function paymentMethodFor(amountCash: number, amountUpi: number, amountDue: number): PaymentMethod | null {
  if (amountCash === 0 && amountUpi === 0) return amountDue > 0 ? "credit" : null;
  if (amountCash > 0 && amountUpi > 0) return "split";
  return amountUpi > 0 ? "upi" : "cash";
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
  // Optional: only present once supabase/migration-payment-split.sql has
  // been run. Missing (not just null) on any row fetched before that.
  amount_cash?: number;
  amount_upi?: number;
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
const fromRow = (row: BillRow): Bill => {
  const amountPaid = Number(row.amount_paid);
  // Before the migration adds these columns, fall back to the old
  // single-method assumption so a fetch that predates it still displays
  // sensibly instead of showing every rupee as cash.
  const amountCash =
    row.amount_cash != null ? Number(row.amount_cash) : row.payment_method === "upi" ? 0 : amountPaid;
  const amountUpi =
    row.amount_upi != null ? Number(row.amount_upi) : row.payment_method === "upi" ? amountPaid : 0;
  return {
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
    amountPaid,
    amountCash,
    amountUpi,
    amountDue: Number(row.amount_due),
    paymentMethod: row.payment_method as PaymentMethod | null,
    shares: row.shares,
    status: row.status as Bill["status"],
    createdAt: new Date(row.created_at).getTime(),
    paidAt: row.paid_at ? new Date(row.paid_at).getTime() : null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
    matchParticipants: row.match_participants ?? null,
    matchLosers: row.match_losers ?? null,
  };
};
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
  amount_cash: b.amountCash,
  amount_upi: b.amountUpi,
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
  recordCreditSettlement: (input: {
    customerId: string;
    customerName: string;
    amountCash: number;
    amountUpi: number;
    discount: number;
  }) => Bill;
  settlePayment: (id: string, input: SettleInput) => Bill | undefined;
  settleShare: (billId: string, shareId: string, input: SettleShareInput) => { bill: Bill; share: BillShare } | undefined;
  cancelBill: (id: string) => void;
  // Moves every bill referencing customer `fromId` (or their old name in a
  // match/share snapshot) onto `toId`/`toName` — used when two duplicate
  // customer profiles are merged into one.
  reassignCustomer: (fromId: string, fromName: string, toId: string, toName: string) => void;
  deleteBill: (id: string) => void;
  softDeleteBill: (id: string) => void;
  restoreBill: (id: string) => void;
  permanentlyDeleteBill: (id: string) => void;
  todaysBills: () => Bill[];
  resetAll: () => void;
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
          amountCash: 0,
          amountUpi: 0,
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

      // A customer paying off some or all of a standing credit balance —
      // recorded as its own already-settled bill (not tied to a table) so
      // it counts toward the day's cash/UPI collected and shows up in that
      // customer's own history, instead of just silently shrinking a number
      // with no record of when or how.
      recordCreditSettlement: (input) => {
        const amountPaid = input.amountCash + input.amountUpi;
        const total = amountPaid + input.discount;
        const bill: Bill = {
          id: crypto.randomUUID(),
          tableId: null,
          tableName: "Credit settlement",
          orderId: null,
          gameId: null,
          gameName: null,
          customerId: input.customerId,
          tableChargeMinutes: 0,
          tableCharge: 0,
          canteenCharge: 0,
          canteenItems: [],
          discount: input.discount,
          total,
          amountPaid,
          amountCash: input.amountCash,
          amountUpi: input.amountUpi,
          amountDue: 0,
          paymentMethod: paymentMethodFor(input.amountCash, input.amountUpi, 0),
          shares: null,
          status: "paid",
          createdAt: Date.now(),
          paidAt: Date.now(),
          deletedAt: null,
          matchParticipants: null,
          matchLosers: null,
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
            const rawCash = Math.max(0, input.amountCash);
            const rawUpi = Math.max(0, input.amountUpi);
            // Clamp the combined total against what's actually owed, trimming
            // upi first then cash if the two together overshoot it.
            const overshoot = Math.max(0, rawCash + rawUpi - b.total);
            const amountUpi = Math.max(0, rawUpi - overshoot);
            const amountCash = Math.max(0, rawCash - Math.max(0, overshoot - rawUpi));
            const amountPaid = amountCash + amountUpi;
            const amountDue = Math.round((b.total - amountPaid) * 100) / 100;
            updated = {
              ...b,
              status: "paid",
              paymentMethod: paymentMethodFor(amountCash, amountUpi, amountDue),
              amountPaid,
              amountCash,
              amountUpi,
              amountDue,
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
            const paidShares = shares.filter((s) => s.status === "paid");
            const amountCash = paidShares
              .filter((s) => s.paymentMethod === "cash")
              .reduce((sum, s) => sum + s.amount, 0);
            const amountUpi = paidShares
              .filter((s) => s.paymentMethod === "upi")
              .reduce((sum, s) => sum + s.amount, 0);
            const amountDue = paidShares
              .filter((s) => s.paymentMethod === "credit")
              .reduce((sum, s) => sum + s.amount, 0);
            const updated: Bill = {
              ...b,
              shares,
              amountPaid: amountCash + amountUpi,
              amountCash,
              amountUpi,
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

      reassignCustomer: (fromId, fromName, toId, toName) => {
        const swapName = (n: string) => (n === fromName ? toName : n);
        // After the swap the merged person can appear twice in a match they
        // played with their own duplicate — collapse those back to one entry.
        const swapList = (list: string[] | null) => {
          if (!list) return null;
          const seen = new Set<string>();
          const out: string[] = [];
          for (const n of list.map(swapName)) {
            if (seen.has(n)) continue;
            seen.add(n);
            out.push(n);
          }
          return out;
        };
        const rewrite = (b: Bill): Bill | null => {
          const hitId = b.customerId === fromId;
          const hitParticipants = b.matchParticipants?.includes(fromName) ?? false;
          const hitLosers = b.matchLosers?.includes(fromName) ?? false;
          const hitShares = b.shares?.some((s) => s.payerName === fromName) ?? false;
          if (!hitId && !hitParticipants && !hitLosers && !hitShares) return null;
          return {
            ...b,
            customerId: hitId ? toId : b.customerId,
            matchParticipants: swapList(b.matchParticipants),
            matchLosers: swapList(b.matchLosers),
            shares: b.shares?.map((s) => ({ ...s, payerName: swapName(s.payerName) })) ?? null,
          };
        };
        const touched: Bill[] = [];
        set((state) => ({
          bills: state.bills.map((b) => {
            const next = rewrite(b);
            if (next) touched.push(next);
            return next ?? b;
          }),
          deletedBills: state.deletedBills.map((b) => {
            const next = rewrite(b);
            if (next) touched.push(next);
            return next ?? b;
          }),
        }));
        for (const b of touched) pushUpsert(TABLE, toRow(b));
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
        // Otherwise the canteen order this came from is stuck showing
        // "Billed" forever with no bill behind it to open — put it back to
        // "served" so it's visible/editable/deletable from Canteen again.
        if (bill.orderId) useOrdersStore.getState().unmarkBilled(bill.orderId);
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
        if (bill.orderId) useOrdersStore.getState().markBilled(bill.orderId);
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
      version: 8,
      migrate: (persisted) => {
        const state = persisted as {
          bills?: (Partial<Bill> & { id: string; total: number; matchLoser?: string | null })[];
          deletedBills?: (Partial<Bill> & { id: string; total: number; matchLoser?: string | null })[];
        };
        const fill = (b: Partial<Bill> & { id: string; total: number; matchLoser?: string | null }): Bill => {
          const amountPaid = b.amountPaid ?? (b.status === "paid" ? b.total : 0);
          // Bills recorded before the cash/account split existed only ever
          // had one method for the whole amountPaid — keep that as-is rather
          // than guessing it was split.
          const amountCash = b.amountCash ?? (b.paymentMethod === "upi" ? 0 : amountPaid);
          const amountUpi = b.amountUpi ?? (b.paymentMethod === "upi" ? amountPaid : 0);
          return {
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
          amountPaid,
          amountCash,
          amountUpi,
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
          };
        };
        return {
          bills: (state.bills ?? []).map(fill),
          deletedBills: (state.deletedBills ?? []).map(fill),
        };
      },
    }
  )
);

// Cash/account amounts are only readable from the cloud once
// supabase/migration-payment-split.sql has been run — until then a fetch
// always comes back with amount_cash/amount_upi missing, and fromRow's
// best-effort fallback would silently overwrite an already-recorded split
// with its single-method guess. Keep this device's real split instead.
function keepLocalPaymentSplit(incoming: Bill, local: Bill | undefined): Bill {
  if (!local) return incoming;
  if (incoming.amountCash === local.amountCash && incoming.amountUpi === local.amountUpi) return incoming;
  if (incoming.paymentMethod !== "split" && local.paymentMethod === "split") {
    return { ...incoming, amountCash: local.amountCash, amountUpi: local.amountUpi, paymentMethod: local.paymentMethod };
  }
  return incoming;
}

setupSync<BillRow, Bill>(
  TABLE,
  fromRow,
  toRow,
  () => [...useBillsStore.getState().bills, ...useBillsStore.getState().deletedBills],
  (allBills) => {
    useBillsStore.setState((state) => {
      const localAll = [...state.bills, ...state.deletedBills];
      const byId = new Map(localAll.map((b) => [b.id, b]));
      const merged = allBills.map((b) => keepLocalPaymentSplit(b, byId.get(b.id)));
      // A bill created in the gap between this fetch starting and resolving
      // (typically: right after opening/reloading the app) must not vanish
      // — see keepLocalOnly's own comment for why.
      const full = [...merged, ...keepLocalOnly(allBills, localAll)];
      return {
        bills: full.filter((b) => !b.deletedAt),
        deletedBills: full.filter((b) => !!b.deletedAt),
      };
    });
  },
  (bill) =>
    useBillsStore.setState((state) => {
      const existing = state.bills.find((b) => b.id === bill.id) ?? state.deletedBills.find((b) => b.id === bill.id);
      const merged = keepLocalPaymentSplit(bill, existing);
      const bills = state.bills.filter((b) => b.id !== merged.id);
      const deletedBills = state.deletedBills.filter((b) => b.id !== merged.id);
      return merged.deletedAt
        ? { bills, deletedBills: [merged, ...deletedBills] }
        : { bills: [merged, ...bills], deletedBills };
    }),
  (id) =>
    useBillsStore.setState((state) => ({
      bills: state.bills.filter((b) => b.id !== id),
      deletedBills: state.deletedBills.filter((b) => b.id !== id),
    }))
);
