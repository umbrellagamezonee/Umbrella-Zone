import type { Bill, CanteenOrder, Customer } from "../types";
import { billParts, customerPendingOrders, orderTotal } from "./billing";
import { isCreditSettlement } from "./billLabel";
import { normalizeName } from "./customerName";
import { toDateInputValue } from "./format";
import { buildLedger, customerCreditByBusiness } from "./ledger";

// Customers, day by day: for every customer, what happened in a day (or in the 7 days / any period):
// what they played and ate (Gaming and Canteen apart), what they paid at once (Cash and Account
// apart), what they took on credit, what they paid back of old credit, and what they owe now.
// Every number comes from the same customer ledger the profile screen and the Credits page use,
// so the three can never disagree.

export interface ActivityTotals {
  bills: number;
  gamingBill: number;
  canteenBill: number;
  cash: number;
  upi: number;
  creditGaming: number; // taken on credit
  creditCanteen: number;
  paidBackCash: number; // old credit paid back
  paidBackUpi: number;
  forgiven: number; // written off (maaf)
  clearedGaming: number; // which part of their credit that payment cleared
  clearedCanteen: number;
}

export interface CustomerActivityRow extends ActivityTotals {
  customerId: string;
  name: string;
  phone: string;
  // what they owe right now
  owedGaming: number;
  owedCanteen: number;
}

export const zeroTotals = (): ActivityTotals => ({
  bills: 0,
  gamingBill: 0,
  canteenBill: 0,
  cash: 0,
  upi: 0,
  creditGaming: 0,
  creditCanteen: 0,
  paidBackCash: 0,
  paidBackUpi: 0,
  forgiven: 0,
  clearedGaming: 0,
  clearedCanteen: 0,
});

// How much of one person's share of a bill was gaming and canteen, and how much of it they
// paid at once in cash / account. (What went on credit comes from the ledger.)
export function personParts(bill: Bill, nameKey: string) {
  const out = { billedG: 0, billedC: 0, cashG: 0, cashC: 0, upiG: 0, upiC: 0 };
  if (bill.shares) {
    const raw = bill.tableCharge + bill.canteenCharge;
    for (const s of bill.shares) {
      if (normalizeName(s.payerName) !== nameKey) continue;
      const gf = s.label === "Table charge" ? 1 : /^share$/i.test(s.label.trim()) && raw > 0 ? bill.tableCharge / raw : 0;
      out.billedG += s.amount * gf;
      out.billedC += s.amount * (1 - gf);
      if (s.status === "paid" && s.paymentMethod === "cash") {
        out.cashG += s.amount * gf;
        out.cashC += s.amount * (1 - gf);
      } else if (s.status === "paid" && s.paymentMethod === "upi") {
        out.upiG += s.amount * gf;
        out.upiC += s.amount * (1 - gf);
      }
    }
    return out;
  }
  const p = billParts(bill);
  out.billedG = p.gaming.total;
  out.billedC = p.canteen.total;
  if (bill.status === "paid") {
    out.cashG = p.gaming.cash;
    out.cashC = p.canteen.cash;
    out.upiG = p.gaming.upi;
    out.upiC = p.canteen.upi;
  }
  return out;
}

// Customers who did anything between startMs and endMs (end not included), most to least, with
// their figures for that period, the total of them all, and the same totals day by day.
export function customerActivity(
  customers: Customer[],
  bills: Bill[],
  orders: CanteenOrder[],
  startMs: number,
  endMs: number
): { rows: CustomerActivityRow[]; total: ActivityTotals; days: Map<string, ActivityTotals> } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  // only people who have a bill, a settlement or an order in the period need their ledger worked out
  const nameKeys = new Set<string>();
  const ids = new Set<string>();
  for (const b of bills) {
    if (b.status === "cancelled" || b.createdAt < startMs || b.createdAt >= endMs) continue;
    if (b.shares) for (const s of b.shares) nameKeys.add(normalizeName(s.payerName));
    else if (b.customerId) ids.add(b.customerId);
  }
  for (const o of orders) {
    if (o.customerId && o.createdAt >= startMs && o.createdAt < endMs) ids.add(o.customerId);
  }

  const total = zeroTotals();
  const days = new Map<string, ActivityTotals>();
  const rows: CustomerActivityRow[] = [];
  for (const c of customers) {
    if (c.isWalkIn) continue;
    const nameKey = normalizeName(c.name);
    if (!ids.has(c.id) && !nameKeys.has(nameKey)) continue;
    const mine = bills.filter((b) => {
      if (b.status === "cancelled") return false;
      return b.shares ? b.shares.some((s) => normalizeName(s.payerName) === nameKey) : b.customerId === c.id;
    });
    const pending = customerPendingOrders(orders, bills, c.id);
    const entries = buildLedger(mine, pending, nameKey, orders);
    const row: CustomerActivityRow = { ...zeroTotals(), customerId: c.id, name: c.name, phone: c.phone, owedGaming: 0, owedCanteen: 0 };
    let touched = false;
    for (const e of entries) {
      if (e.date < startMs || e.date >= endMs) continue;
      touched = true;
      const day = toDateInputValue(e.date);
      const d = days.get(day) ?? zeroTotals();
      days.set(day, d);
      const add = (key: keyof ActivityTotals, v: number) => {
        row[key] += v;
        d[key] += v;
        total[key] += v;
      };
      if (e.bill && isCreditSettlement(e.bill)) {
        add("paidBackCash", e.bill.amountCash);
        add("paidBackUpi", e.bill.amountUpi);
        add("forgiven", e.bill.discount);
        add("clearedGaming", e.creditGaming);
        add("clearedCanteen", e.creditCanteen);
      } else if (e.bill) {
        const p = personParts(e.bill, nameKey);
        add("bills", 1);
        add("gamingBill", p.billedG);
        add("canteenBill", p.billedC);
        add("cash", p.cashG + p.cashC);
        add("upi", p.upiG + p.upiC);
        add("creditGaming", e.debitGaming);
        add("creditCanteen", e.debitCanteen);
      } else if (e.order) {
        // food served on the tab that has no bill yet
        add("canteenBill", orderTotal(e.order));
        add("creditCanteen", e.debitCanteen);
      }
    }
    if (!touched) continue;
    // what they owe right now - the same figure the Credits page shows
    const owed = customerCreditByBusiness(c, bills, orders);
    row.owedGaming = owed.gaming;
    row.owedCanteen = owed.canteen;
    for (const k of Object.keys(row) as (keyof CustomerActivityRow)[]) if (typeof row[k] === "number") (row as unknown as Record<string, number>)[k as string] = r2(row[k] as number);
    rows.push(row);
  }
  for (const k of Object.keys(total) as (keyof ActivityTotals)[]) total[k] = r2(total[k]);
  for (const d of days.values()) for (const k of Object.keys(d) as (keyof ActivityTotals)[]) d[k] = r2(d[k]);
  rows.sort(
    (a, b) =>
      b.gamingBill + b.canteenBill + b.paidBackCash + b.paidBackUpi - (a.gamingBill + a.canteenBill + a.paidBackCash + a.paidBackUpi) ||
      a.name.localeCompare(b.name)
  );
  return { rows, total, days };
}
