import type { Bill, PaymentMethod } from "../types";

export interface BillMoney {
  cash: number;
  upi: number;
  credit: number;
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
        result[s.paymentMethod] += s.amount;
      }
    }
    return result;
  }
  if (bill.status !== "paid") return result;
  if (bill.paymentMethod === "cash") result.cash = bill.amountPaid;
  else if (bill.paymentMethod === "upi") result.upi = bill.amountPaid;
  result.credit = bill.amountDue;
  return result;
}

export function billCollected(bill: Bill): number {
  const m = billMoney(bill);
  return m.cash + m.upi;
}

// Splits a bill's collected (cash+upi) total between its table and canteen
// portions, for the POS/Canteen "today's amount" widgets. Split bills
// attribute by each share's label; simple bills prorate by how much of the
// total has actually been collected so far (a partial payment could be any
// mix of the two, so this is the fairest approximation without itemizing).
export function billCollectedByPart(bill: Bill): { table: number; canteen: number } {
  if (bill.shares) {
    let table = 0;
    let canteen = 0;
    for (const s of bill.shares) {
      if (s.status !== "paid" || s.paymentMethod === "credit" || !s.paymentMethod) continue;
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

export function sumBillMoney(bills: Bill[]): BillMoney {
  const total: BillMoney = { cash: 0, upi: 0, credit: 0 };
  const methods: PaymentMethod[] = ["cash", "upi", "credit"];
  for (const bill of bills) {
    const m = billMoney(bill);
    for (const method of methods) total[method] += m[method];
  }
  return total;
}
