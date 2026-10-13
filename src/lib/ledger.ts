import type { Bill, CanteenOrder, Customer } from "../types";
import { customerPendingOrders, orderTotal, personBillView } from "./billing";
import { isCreditSettlement } from "./billLabel";
import { normalizeName } from "./customerName";
import { dateInputValueToIstMidnight, formatDateKey, toDateInputValue } from "./format";

// A customer's running-balance account — shared by their profile screen and
// by the month-wise credit report, so both always show the same figures.

export interface LedgerEntry {
  id: string;
  date: number;
  particulars: string;
  debit: number; // charged onto their running balance
  credit: number; // paid off their running balance
  paidNow: boolean; // settled in cash/account on the spot — never touched the balance at all
  balanceAfter: number;
  bill: Bill | null; // set for anything tappable through to the full receipt
  order: CanteenOrder | null; // set only for a still-pending (unbilled) order
  // Set when a bill was made long after its order — shown on the date line
  // ("ordered 27 Sept") so a backlog that got billed in one go can't read as
  // a fresh charge dated today.
  orderedNote: string | null;
}

// What this line is actually for. A table session (has a real tableId)
// shows the table's name; anything canteen-only shows what was actually
// ordered instead — a standalone order's bill.tableName is set to the
// customer's own name (see handleBillOrder/Credits' handleSettleClick), not
// a useful description, so falling back to it here would just repeat their
// name for every line.
function describeItems(items: { name: string; qty: number }[]): string {
  if (items.length === 0) return "Canteen order";
  return items.map((i) => (i.qty > 1 ? `${i.name} x${i.qty}` : i.name)).join(", ");
}

// One running-balance account for this customer — every bill that's ever
// touched their credit, plus whatever's served but not yet billed, in
// time order. Processed oldest-first so the balance accumulates correctly
// (a credit settlement pays down exactly what came before it), then handed
// back newest-first to display, each row keeping the balance as it stood
// right after that entry.
// A bill created many hours after its order (an old stuck order finally
// cleared through checkout) should say so — otherwise the ledger shows a
// charge dated to a day the customer may not have even visited, looking
// exactly like a wrong-person mistake when it's really just late billing.
const LATE_BILL_GAP_MS = 6 * 60 * 60 * 1000;

// The period picked above the ledger: "all", one month ("YYYY-MM"), or a
// custom from/to date. Returns null for "everything".
export function ledgerPeriodRange(
  period: string,
  from: string,
  to: string
): { startMs: number; endMs: number } | null {
  if (period === "all") return null;
  if (period === "custom") {
    if (!from && !to) return null;
    return {
      startMs: from ? dateInputValueToIstMidnight(from) : -Infinity,
      endMs: to ? dateInputValueToIstMidnight(to) + 86_400_000 : Infinity,
    };
  }
  const [y, m] = period.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { startMs: dateInputValueToIstMidnight(`${period}-01`), endMs: dateInputValueToIstMidnight(next) };
}

export function buildLedger(
  customerBills: Bill[],
  pendingOrders: CanteenOrder[],
  nameKey: string,
  allOrders: CanteenOrder[]
): LedgerEntry[] {
  const orderById = new Map(allOrders.map((o) => [o.id, o]));
  type RawEvent =
    | { date: number; kind: "bill"; bill: Bill }
    | { date: number; kind: "pending"; order: CanteenOrder };
  const rawEvents: RawEvent[] = [
    ...customerBills.map((b): RawEvent => ({ date: b.createdAt, kind: "bill", bill: b })),
    ...pendingOrders.map((o): RawEvent => ({ date: o.createdAt, kind: "pending", order: o })),
  ].sort((a, b) => a.date - b.date);

  let balance = 0;
  const entries = rawEvents.map((ev): LedgerEntry => {
    if (ev.kind === "pending") {
      const amount = orderTotal(ev.order);
      balance += amount;
      return {
        id: `pending-${ev.order.id}`,
        date: ev.date,
        particulars: describeItems(ev.order.items),
        debit: amount,
        credit: 0,
        paidNow: false,
        balanceAfter: balance,
        bill: null,
        order: ev.order,
        orderedNote: null,
      };
    }
    const b = ev.bill;
    if (isCreditSettlement(b)) {
      const amount = b.amountPaid + b.discount;
      balance -= amount;
      return {
        id: b.id,
        date: b.createdAt,
        particulars: "Credit settled",
        debit: 0,
        credit: amount,
        paidNow: false,
        balanceAfter: balance,
        bill: b,
        order: null,
        orderedNote: null,
      };
    }
    const view = personBillView(b, nameKey);
    if (view.onCredit > 0) balance += view.onCredit;
    const particulars = b.tableId ? (b.tableName ?? "Table") : describeItems(b.canteenItems);
    const orderedAt = b.orderId ? orderById.get(b.orderId)?.createdAt : null;
    const orderedNote =
      orderedAt != null && b.createdAt - orderedAt > LATE_BILL_GAP_MS
        ? `ordered ${formatDateKey(toDateInputValue(orderedAt), { day: "numeric", month: "short" })}`
        : null;
    return {
      id: b.id,
      date: b.createdAt,
      particulars,
      debit: view.onCredit,
      credit: 0,
      paidNow: view.onCredit === 0,
      balanceAfter: balance,
      bill: b,
      order: null,
      orderedNote,
    };
  });

  return entries.reverse();
}

// One customer's credit for a period: the balance when it started, what they
// took on credit, what they paid off (cash, account and any discount), and the
// balance at its end. Built from the very same ledger the profile screen shows
// (served-but-unbilled orders count as taken when they were ordered).
export interface PeriodCredit {
  opening: number;
  added: number;
  paid: number;
  closing: number;
  entries: number;
}

export function periodCredit(entries: LedgerEntry[], startMs: number, endMs: number): PeriodCredit {
  // entries are newest-first
  const inRange = entries.filter((e) => e.date >= startMs && e.date < endMs);
  const opening = entries.find((e) => e.date < startMs)?.balanceAfter ?? 0;
  const added = inRange.reduce((s, e) => s + e.debit, 0);
  const paid = inRange.reduce((s, e) => s + e.credit, 0);
  const closing = inRange.length > 0 ? inRange[0].balanceAfter : opening;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { opening: round(opening), added: round(added), paid: round(paid), closing: round(closing), entries: inRange.length };
}

export interface CustomerMonthCredit extends PeriodCredit {
  customerId: string;
  name: string;
}

// Every customer's credit for one month ("YYYY-MM"), most credit first. Only
// people with something that month (credit taken or paid) are listed.
export function monthlyCreditByCustomer(
  bills: Bill[],
  orders: CanteenOrder[],
  customers: Customer[],
  monthKey: string
): CustomerMonthCredit[] {
  const range = ledgerPeriodRange(monthKey, "", "");
  if (!range) return [];
  const rows: CustomerMonthCredit[] = [];
  for (const c of customers) {
    if (c.isWalkIn) continue;
    const nameKey = normalizeName(c.name);
    const mine = bills.filter((b) =>
      b.shares ? b.shares.some((s) => normalizeName(s.payerName) === nameKey) : b.customerId === c.id
    );
    const pending = customerPendingOrders(orders, bills, c.id);
    if (mine.length === 0 && pending.length === 0) continue;
    const entries = buildLedger(mine, pending, nameKey, orders);
    const p = periodCredit(entries, range.startMs, range.endMs);
    if (p.added < 0.005 && p.paid < 0.005) continue;
    rows.push({ customerId: c.id, name: c.name, ...p });
  }
  return rows.sort((a, b) => b.added - a.added || a.name.localeCompare(b.name));
}

// Months that have any ledger entry for anyone, newest first ("YYYY-MM").
export function creditMonthKeys(bills: Bill[], orders: CanteenOrder[]): string[] {
  const keys = new Set<string>();
  for (const b of bills) if (b.status !== "cancelled") keys.add(toDateInputValue(b.createdAt).slice(0, 7));
  for (const o of orders) keys.add(toDateInputValue(o.createdAt).slice(0, 7));
  return [...keys].sort().reverse();
}
