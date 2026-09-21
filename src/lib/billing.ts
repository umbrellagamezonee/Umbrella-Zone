import type { Bill, CanteenOrder, PaymentMethod } from "../types";
import { normalizeName } from "./customerName";
import { isCreditSettlement } from "./billLabel";

export interface BillMoney {
  cash: number;
  upi: number;
  credit: number;
}

// A share only ever settles as one of cash/upi/credit (never "split" — that
// only describes a whole bill's amountPaid being divided between the first
// two), so this only needs to handle those three.
function addByMethod(result: BillMoney, method: PaymentMethod, amount: number) {
  if (method === "cash") result.cash += amount;
  else if (method === "upi") result.upi += amount;
  else if (method === "credit") result.credit += amount;
}

// Actual money collected/owed for a bill, broken down by method. A split
// bill's overall `status` only flips to "paid" once every share is settled,
// so we read the shares directly here — otherwise cash already collected on
// an early share would vanish from every report until the last payer shows up.
export function billMoney(bill: Bill): BillMoney {
  const result: BillMoney = { cash: 0, upi: 0, credit: 0 };
  if (bill.shares) {
    for (const s of bill.shares) {
      if (s.status === "paid" && s.paymentMethod) {
        addByMethod(result, s.paymentMethod, s.amount);
      }
    }
    return result;
  }
  if (bill.status !== "paid") return result;
  result.cash = bill.amountCash;
  result.upi = bill.amountUpi;
  result.credit = bill.amountDue;
  return result;
}

export function billCollected(bill: Bill): number {
  const m = billMoney(bill);
  return m.cash + m.upi;
}

// How much of a bill THIS specific person paid — for a split bill, only
// their own share; for a non-split bill, the whole thing (it's entirely
// theirs). Used for a customer's own "total spent" so splitting a table bill
// among several people doesn't attribute the full amount to each of them.
export function billCollectedFor(bill: Bill, payerNameKey: string): number {
  if (!bill.shares) return billCollected(bill);
  return bill.shares
    .filter(
      (s) =>
        s.status === "paid" &&
        s.paymentMethod &&
        s.paymentMethod !== "credit" &&
        normalizeName(s.payerName) === payerNameKey
    )
    .reduce((sum, s) => sum + s.amount, 0);
}

export interface PersonBillView {
  total: number;
  paidFully: boolean;
  onCredit: number;
  pending: boolean;
}

// How a bill should read on ONE person's own profile — for a split bill,
// only their own shares (their portion of the total, whether they've paid
// it, how much of it is sitting on credit), not the whole group's numbers.
// A non-split bill is already entirely theirs, so this just mirrors its own
// fields. Used anywhere a bill gets listed on a specific customer's history
// — showing the full group total there (e.g. "₹34 on credit" on a page
// split two ways) reads as if this one person owes all of it.
export function personBillView(bill: Bill, payerNameKey: string): PersonBillView {
  if (!bill.shares) {
    return {
      total: bill.total,
      paidFully: bill.status === "paid" && bill.amountPaid > 0 && bill.amountDue === 0,
      onCredit: bill.amountDue,
      pending: bill.status === "open",
    };
  }
  const mine = bill.shares.filter((s) => normalizeName(s.payerName) === payerNameKey);
  const total = mine.reduce((sum, s) => sum + s.amount, 0);
  const onCredit = mine
    .filter((s) => s.status === "paid" && s.paymentMethod === "credit")
    .reduce((sum, s) => sum + s.amount, 0);
  const paidCashOrUpi = mine.some((s) => s.status === "paid" && s.paymentMethod !== "credit");
  const pending = mine.some((s) => s.status !== "paid");
  return { total, paidFully: !pending && onCredit === 0 && paidCashOrUpi, onCredit, pending };
}

// What a customer actually owes on credit right now — computed fresh from
// every bill each time, never a separately-stored running total. A stored
// "credit balance" that gets nudged up/down by a separate increment call
// per transaction can silently drift from reality forever the moment any
// one of those network calls fails quietly (weak wifi, device closed mid
// sync, etc) — nothing else would ever notice or correct it. Recomputing
// from the bills themselves (the same records the ledger already reads)
// means the number shown is always exactly what really happened, with
// nothing else to go stale. Only "paid" bills count — a still-open
// (stuck-checkout) bill or an unbilled canteen order genuinely isn't credit
// yet; see customerOpenBills/customerPendingOrders for those.
export function creditBalanceFor(bills: Bill[], customerId: string, nameKey: string): number {
  let balance = 0;
  for (const b of bills) {
    if (b.status !== "paid") continue;
    const matches = b.shares
      ? b.shares.some((s) => normalizeName(s.payerName) === nameKey)
      : b.customerId === customerId;
    if (!matches) continue;
    if (isCreditSettlement(b)) {
      balance -= b.amountPaid + b.discount;
    } else {
      balance += personBillView(b, nameKey).onCredit;
    }
  }
  return Math.round(balance * 100) / 100;
}

// Splits a bill's collected (cash+upi) total between its table and canteen
// portions, for the POS/Canteen "today's amount" widgets. A split bill's
// "Table charge" and "Food" shares (see TableDetailModal's handleStopAndBill)
// are independently payable — someone might settle their food and leave the
// table charge pending, or vice versa — so this reads each share's own
// label rather than assuming collected money splits in the bill's overall
// ratio. A non-split bill has no such distinction, so it prorates by
// however much of the total has been collected so far.
export function billCollectedByPart(bill: Bill): { table: number; canteen: number } {
  if (bill.shares) {
    let table = 0;
    let canteen = 0;
    for (const s of bill.shares) {
      if (s.status !== "paid" || !s.paymentMethod || s.paymentMethod === "credit") continue;
      if (s.label === "Table charge") table += s.amount;
      else canteen += s.amount;
    }
    return { table, canteen };
  }
  if (bill.total <= 0) return { table: 0, canteen: 0 };
  const paidFraction = billCollected(bill) / bill.total;
  return {
    table: bill.tableCharge * paidFraction,
    canteen: bill.canteenCharge * paidFraction,
  };
}

// How much of a bill's total is still unsettled — for split bills that's the
// total minus whatever shares have actually been paid so far (not just "0 or
// everything", since a bill stays "open" until the last share is settled).
export function billRemaining(bill: Bill): number {
  if (bill.shares) {
    const settled = bill.shares
      .filter((s) => s.status === "paid")
      .reduce((sum, s) => sum + s.amount, 0);
    return bill.total - settled;
  }
  return bill.status === "paid" ? 0 : bill.total;
}

export function orderTotal(order: CanteenOrder): number {
  return order.items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

// Food served to a customer but not yet turned into a bill — money already
// earned that won't show up in their credit balance until someone taps
// "Bill this order". Used to fold it into a customer's real total owed
// instead of just the already-billed credit ledger.
export function customerPendingOrders(orders: CanteenOrder[], bills: Bill[], customerId: string): CanteenOrder[] {
  return orders.filter(
    (o) => o.customerId === customerId && o.status === "served" && !bills.some((b) => b.orderId === o.id)
  );
}

// Bills that already exist (Stop & Bill, or "Bill this order") but got left
// stuck "open" — nobody ever tapped Cash/Account/"Full amount on credit" to
// actually settle them (checkout screen closed early, app switched away
// mid-flow, etc). Real money already owed, just not yet reflected in
// creditBalance — same idea as customerPendingOrders, one step further along.
export function customerOpenBills(bills: Bill[], customerId: string): Bill[] {
  return bills.filter((b) => b.customerId === customerId && !b.shares && b.status === "open");
}

export function sumBillMoney(bills: Bill[]): BillMoney {
  const total: BillMoney = { cash: 0, upi: 0, credit: 0 };
  for (const bill of bills) {
    const m = billMoney(bill);
    total.cash += m.cash;
    total.upi += m.upi;
    total.credit += m.credit;
  }
  return total;
}
