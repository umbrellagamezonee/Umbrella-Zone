import type { Bill, PaymentMethod } from "../types";

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
  for (const bill of bills) {
    const m = billMoney(bill);
    total.cash += m.cash;
    total.upi += m.upi;
    total.credit += m.credit;
  }
  return total;
}
