import type { Bill, CanteenOrder, Customer } from "../types";
import { billParts, creditByBusiness, customerPendingOrders, orderTotal, personBillView } from "./billing";
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
  // The same entry split into the two businesses. A charge shows how much of
  // it was gaming and how much canteen; a payment shows which of the two
  // debts it cleared (oldest debt first, as a shopkeeper's khata works); and
  // gamingAfter / canteenAfter are what is still owed on each right after.
  debitGaming: number;
  debitCanteen: number;
  creditGaming: number;
  creditCanteen: number;
  gamingAfter: number;
  canteenAfter: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// Running per-business debts for one customer. Every charge is a lump with a
// gaming part and a canteen part; a payment clears the oldest lumps first,
// taking from both parts of a lump in proportion. A payment that is more than
// is owed becomes an advance that the next charge uses up first.
function createDebtBook() {
  const lumps: { g: number; c: number }[] = [];
  let advance = 0;
  let gaming = 0;
  let canteen = 0;
  return {
    charge(g: number, c: number) {
      let lg = g;
      let lc = c;
      const tot = lg + lc;
      if (advance > 0.005 && tot > 0.005) {
        const take = Math.min(advance, tot);
        lg -= (lg * take) / tot;
        lc -= (lc * take) / tot;
        advance -= take;
      }
      if (lg + lc > 0.005) lumps.push({ g: lg, c: lc });
      gaming += lg;
      canteen += lc;
    },
    pay(amount: number) {
      let left = amount;
      let pg = 0;
      let pc = 0;
      while (left > 0.005 && lumps.length > 0) {
        const lump = lumps[0];
        const tot = lump.g + lump.c;
        const take = Math.min(tot, left);
        const tg = (lump.g * take) / tot;
        const tc = take - tg;
        lump.g -= tg;
        lump.c -= tc;
        pg += tg;
        pc += tc;
        left -= take;
        if (lump.g + lump.c <= 0.005) lumps.shift();
      }
      if (left > 0.005) advance += left;
      gaming -= pg;
      canteen -= pc;
      return { gaming: pg, canteen: pc };
    },
    owed: () => ({ gaming: r2(Math.max(0, gaming)), canteen: r2(Math.max(0, canteen)) }),
  };
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
  const book = createDebtBook();
  const entries = rawEvents.map((ev): LedgerEntry => {
    if (ev.kind === "pending") {
      const amount = orderTotal(ev.order);
      balance += amount;
      book.charge(0, amount);
      return {
        debitGaming: 0,
        debitCanteen: r2(amount),
        creditGaming: 0,
        creditCanteen: 0,
        gamingAfter: book.owed().gaming,
        canteenAfter: book.owed().canteen,
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
      const paid = book.pay(amount);
      return {
        debitGaming: 0,
        debitCanteen: 0,
        creditGaming: r2(paid.gaming),
        creditCanteen: r2(paid.canteen),
        gamingAfter: book.owed().gaming,
        canteenAfter: book.owed().canteen,
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
    // the part of this charge that is gaming and the part that is canteen
    let dg = 0;
    let dc = 0;
    if (view.onCredit > 0) {
      if (b.shares) {
        const s = creditByBusiness(b, nameKey);
        dg = s.gaming;
        dc = s.canteen;
      } else {
        const p = billParts(b);
        dg = p.gaming.due;
        dc = p.canteen.due;
      }
      // keep the two parts adding up to exactly what went on the tab
      const sum = dg + dc;
      if (sum > 0.005) {
        dg = (dg * view.onCredit) / sum;
        dc = view.onCredit - dg;
      } else {
        dg = 0;
        dc = view.onCredit;
      }
      book.charge(dg, dc);
    }
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
      debitGaming: r2(dg),
      debitCanteen: r2(dc),
      creditGaming: 0,
      creditCanteen: 0,
      gamingAfter: book.owed().gaming,
      canteenAfter: book.owed().canteen,
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
  // the same four figures for each business on its own
  openingGaming: number;
  openingCanteen: number;
  addedGaming: number;
  addedCanteen: number;
  paidGaming: number;
  paidCanteen: number;
  closingGaming: number;
  closingCanteen: number;
}

export function periodCredit(entries: LedgerEntry[], startMs: number, endMs: number): PeriodCredit {
  // entries are newest-first
  const inRange = entries.filter((e) => e.date >= startMs && e.date < endMs);
  const before = entries.find((e) => e.date < startMs);
  const opening = before?.balanceAfter ?? 0;
  const added = inRange.reduce((s, e) => s + e.debit, 0);
  const paid = inRange.reduce((s, e) => s + e.credit, 0);
  const closing = inRange.length > 0 ? inRange[0].balanceAfter : opening;
  const round = (n: number) => Math.round(n * 100) / 100;
  const openingGaming = before?.gamingAfter ?? 0;
  const openingCanteen = before?.canteenAfter ?? 0;
  return {
    opening: round(opening),
    added: round(added),
    paid: round(paid),
    closing: round(closing),
    entries: inRange.length,
    openingGaming: round(openingGaming),
    openingCanteen: round(openingCanteen),
    addedGaming: round(inRange.reduce((s, e) => s + e.debitGaming, 0)),
    addedCanteen: round(inRange.reduce((s, e) => s + e.debitCanteen, 0)),
    paidGaming: round(inRange.reduce((s, e) => s + e.creditGaming, 0)),
    paidCanteen: round(inRange.reduce((s, e) => s + e.creditCanteen, 0)),
    closingGaming: round(inRange.length > 0 ? inRange[0].gamingAfter : openingGaming),
    closingCanteen: round(inRange.length > 0 ? inRange[0].canteenAfter : openingCanteen),
  };
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

// What one customer still owes, split into gaming and canteen — the ledger's
// closing figures (so it counts served-but-unbilled food and bills still open,
// exactly like the total shown on the Credits page).
export function customerCreditByBusiness(
  customer: Customer,
  bills: Bill[],
  orders: CanteenOrder[]
): { gaming: number; canteen: number } {
  const nameKey = normalizeName(customer.name);
  const mine = bills.filter((b) =>
    b.shares ? b.shares.some((s) => normalizeName(s.payerName) === nameKey) : b.customerId === customer.id
  );
  const pending = customerPendingOrders(orders, bills, customer.id);
  if (mine.length === 0 && pending.length === 0) return { gaming: 0, canteen: 0 };
  const newest = buildLedger(mine, pending, nameKey, orders)[0];
  if (!newest) return { gaming: 0, canteen: 0 };
  let gaming = newest.gamingAfter;
  let canteen = newest.canteenAfter;
  // The ledger lists the credit share of a split bill that is still open, but the
  // Credits page only counts it once that bill closes — leave it out here too so
  // the two parts always add up to the total shown next to them.
  for (const b of mine) {
    if (b.shares && b.status === "open") {
      const part = creditByBusiness(b, nameKey);
      gaming -= part.gaming;
      canteen -= part.canteen;
    }
  }
  return { gaming: r2(Math.max(0, gaming)), canteen: r2(Math.max(0, canteen)) };
}
