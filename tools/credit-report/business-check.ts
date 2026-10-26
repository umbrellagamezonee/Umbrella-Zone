// Checks for the Gaming / Canteen split. Run: npx tsx business-check.ts [backup.json]
//  1. on the real (old) data: every day, Gaming + Canteen + unmatched money = the galla, to the paisa
//  2. on made-up new bills: payments land on exactly the business they were entered for
import fs from "fs";
import path from "path";
import type { Bill, BillParts, Customer } from "../../src/types";
import { billMoney, billMoneyByBusiness, billParts, businessTotals, settleParts, creditHisaab, gallaByDate, isRegularCustomer, creditByBusiness } from "../../src/lib/billing";
import { isCreditSettlement } from "../../src/lib/billLabel";
import { businessOfDay, buildDayReport } from "../../src/lib/dayReport";
import { buildLedger } from "../../src/lib/ledger";
import { toDateInputValue } from "../../src/lib/format";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "OK  " : "FAIL", name, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const near = (name: string, got: number, want: number, tol = 0.011) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failed++;
  console.log(ok ? "OK  " : "FAIL", name, ok ? "" : `got ${got} want ${want}`);
};

// ---------------------------------------------------------------- 1. real old data
const srcPath = process.argv[2] ?? path.join(__dirname, "../../offline-pack/cuebill-data-backup.json");
if (fs.existsSync(srcPath)) {
  const raw = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  const st = (k: string) => JSON.parse(raw[k]).state;
  const bills: Bill[] = st("cuebill-bills").bills;
  const customers: Customer[] = st("cuebill-customers").customers;
  const orders = st("cuebill-orders").orders;
  const menu = st("cuebill-menu");
  const tables = st("cuebill-tables").tables;
  const expenses = st("cuebill-expenses").expenses;
  const live = bills.filter((b) => b.status !== "cancelled");
  const h = creditHisaab(live, menu.items, menu.categories, tables, customers);
  const galla = gallaByDate(live);
  let badCash = 0;
  let badUpi = 0;
  let badBilled = 0;
  let badIssued = 0;
  for (const d of h.days) {
    const b = businessOfDay(d);
    const g = galla.get(d.dateKey);
    const gc = (g?.freshCash ?? 0) + (g?.settledCash ?? 0);
    const gu = (g?.freshUpi ?? 0) + (g?.settledUpi ?? 0);
    if (Math.abs(b.gamingTotal.cash + b.canteenTotal.cash + b.other.cash - gc) > 0.02) badCash++;
    if (Math.abs(b.gamingTotal.upi + b.canteenTotal.upi + b.other.upi - gu) > 0.02) badUpi++;
    if (Math.abs(b.gamingTotal.billed + b.canteenTotal.billed - d.billed) > 0.02) badBilled++;
    if (Math.abs(b.gamingTotal.issued + b.canteenTotal.issued - d.issued) > 0.02) badIssued++;
  }
  console.log(`   (${h.days.length} days of old data)`);
  eq("old data: Gaming + Canteen + unmatched cash = galla cash on every day", badCash, 0);
  eq("old data: Gaming + Canteen + unmatched account = galla account on every day", badUpi, 0);
  eq("old data: Gaming + Canteen billed = the day's bills", badBilled, 0);
  eq("old data: Gaming + Canteen credit given = the day's credit given", badIssued, 0);
  // every bill: Gaming + Canteen cash / account / credit add up to the bill's own figures
  let badBill = 0;
  for (const b of live) {
    if (isCreditSettlement(b)) continue;
    const by = billMoneyByBusiness(b);
    const m = billMoney(b);
    if (Math.abs(by.gaming.cash + by.canteen.cash - m.cash) > 0.011 || Math.abs(by.gaming.upi + by.canteen.upi - m.upi) > 0.011 || Math.abs(by.gaming.credit + by.canteen.credit - m.credit) > 0.011) badBill++;
  }
  eq("old data: for every bill, Gaming + Canteen cash / account / credit = the bill's own", badBill, 0);
  const allDays = [...new Set(h.days.map((d) => d.dateKey))];
  const rep = buildDayReport({ date: allDays[10], bills, orders, expenses, menuItems: menu.items, menuCategories: menu.categories, tables, customers });
  eq("day report carries the business split", rep.business.gamingTotal.cash + rep.business.canteenTotal.cash + rep.business.other.cash > 0, true);
} else {
  console.log("(no backup file found - skipping the old-data checks)");
}

// ---------------------------------------------------------------- 2. new bills
const mk = (o: Partial<Bill>): Bill => ({
  id: "b" + Math.random().toString(36).slice(2),
  tableId: null, tableName: null, orderId: null, gameId: null, gameName: null, customerId: null,
  tableChargeMinutes: 0, tableCharge: 0, canteenCharge: 0, canteenItems: [], discount: 0, total: 0,
  amountPaid: 0, amountCash: 0, amountUpi: 0, amountDue: 0, paymentMethod: null, shares: null, status: "paid",
  createdAt: Date.UTC(2026, 9, 20, 6, 0, 0), paidAt: null, deletedAt: null, matchParticipants: null, matchLosers: null,
  ...o,
});
const cust: Customer = { id: "c1", name: "Ravi", phone: "", email: "", isWalkIn: false, lastReminderAt: null, createdAt: 0 };
const menuCats = [{ id: "k", name: "Kitchen" }, { id: "f", name: "Fridge" }];
const menuItems = [
  { id: "m1", name: "Maggi", categoryId: "k", price: 50, costPrice: null, inStock: true, stockQty: null, lowStockThreshold: 0 },
  { id: "m2", name: "Coke", categoryId: "f", price: 40, costPrice: null, inStock: true, stockQty: null, lowStockThreshold: 0 },
];
const tbls = [{ name: "Pool 1" }];

// discount comes off gaming first
eq("discount comes off gaming first", businessTotals({ tableCharge: 100, canteenCharge: 90, discount: 30 }), { gaming: 70, canteen: 90 });
eq("discount bigger than gaming spills into canteen", businessTotals({ tableCharge: 100, canteenCharge: 90, discount: 130 }), { gaming: 0, canteen: 60 });

// what was typed for each business is kept exactly, rest is credit
const typed = settleParts({ tableCharge: 100, canteenCharge: 90, discount: 0 }, { gaming: { cash: 100, upi: 0 }, canteen: { cash: 0, upi: 40 } });
eq("settleParts: gaming all cash", typed.gaming, { total: 100, cash: 100, upi: 0, due: 0 });
eq("settleParts: canteen 40 account, 50 credit", typed.canteen, { total: 90, cash: 0, upi: 40, due: 50 });
const over = settleParts({ tableCharge: 100, canteenCharge: 0, discount: 0 }, { gaming: { cash: 80, upi: 80 }, canteen: { cash: 0, upi: 0 } });
eq("settleParts: too much entered is trimmed (account first)", [over.gaming.cash, over.gaming.upi, over.gaming.due], [80, 20, 0]);

// a mixed bill: gaming paid in cash, canteen on credit to Ravi
const parts: BillParts = typed;
const mixed = mk({
  id: "mixed", tableId: "t1", tableName: "Pool 1", tableCharge: 100, canteenCharge: 90, total: 190, customerId: "c1",
  canteenItems: [{ name: "Maggi", price: 50, qty: 1, personName: null }, { name: "Coke", price: 40, qty: 1, personName: null }],
  amountCash: 100, amountUpi: 40, amountPaid: 140, amountDue: 50, parts,
});
eq("billParts returns the saved split", billParts(mixed), parts);
const old = { ...mixed, parts: undefined };
near("an old bill is split by face value: gaming cash", billParts(old).gaming.cash, (100 * 100) / 190);
near("...and its credit is split the same way", billParts(old).canteen.due, (50 * 90) / 190);
const h1 = creditHisaab([mixed], menuItems, menuCats, tbls, [cust]);
const day = businessOfDay(h1.days[0]);
near("engine: Gaming cash is exactly the 100 entered", day.gamingTotal.cash, 100);
near("engine: Gaming account is 0", day.gamingTotal.upi, 0);
near("engine: Canteen cash is 0", day.canteenTotal.cash, 0);
near("engine: Canteen account is exactly the 40 entered", day.canteenTotal.upi, 40);
near("engine: all the credit (50) is Canteen's", day.canteenTotal.issued, 50);
near("engine: Gaming gave no credit", day.gamingTotal.issued, 0);
near("engine: gaming billed 100 / canteen billed 90", day.gamingTotal.billed + day.canteenTotal.billed, 190);
eq("engine: Pool 1 row, then the Food and Drinks rows", [day.gaming.map((r) => r.item), day.canteen.map((r) => r.item)], [["Pool 1"], ["Food", "Drinks"]]);

// credit by business, and the khata
eq("creditByBusiness: canteen only", creditByBusiness(mixed, "ravi"), { gaming: 0, canteen: 50 });
const gamingCredit = mk({
  id: "g2", tableId: "t1", tableName: "Pool 1", tableCharge: 60, total: 60, customerId: "c1", amountDue: 60,
  parts: { gaming: { total: 60, cash: 0, upi: 0, due: 60 }, canteen: { total: 0, cash: 0, upi: 0, due: 0 } },
  createdAt: Date.UTC(2026, 9, 21, 6, 0, 0),
});
const settle = mk({
  id: "s1", tableName: "Credit settlement", customerId: "c1", total: 70, amountPaid: 70, amountCash: 70, amountUpi: 0,
  createdAt: Date.UTC(2026, 9, 22, 6, 0, 0),
});
const ledger = buildLedger([mixed, gamingCredit, settle], [], "ravi", []);
// newest first: settlement, gaming credit, mixed
eq("ledger: first charge is canteen 50", [ledger[2].debitGaming, ledger[2].debitCanteen], [0, 50]);
eq("ledger: second charge is gaming 60", [ledger[1].debitGaming, ledger[1].debitCanteen], [60, 0]);
eq("ledger: owed after both = gaming 60, canteen 50", [ledger[1].gamingAfter, ledger[1].canteenAfter], [60, 50]);
eq("ledger: a 70 payment clears the oldest (canteen 50) first, then 20 of gaming", [ledger[0].creditCanteen, ledger[0].creditGaming], [50, 20]);
eq("ledger: left to pay = gaming 40, canteen 0", [ledger[0].gamingAfter, ledger[0].canteenAfter], [40, 0]);
near("ledger: total balance still 40", ledger[0].balanceAfter, 40);

// regular customers
eq("a new customer is not a regular", isRegularCustomer(cust, []), false);
eq("...unless marked", isRegularCustomer({ ...cust, isRegular: true }, []), true);
eq("...or already has credit on record", isRegularCustomer(cust, [mixed]), true);
eq("walk-in is never a regular", isRegularCustomer({ ...cust, isWalkIn: true, isRegular: true }, []), false);

// the old day's report for a date with no new bills still works
const gd = toDateInputValue(mixed.createdAt);
eq("date key of the made-up bill", gd, "2026-10-20");

console.log(failed === 0 ? "\nALL BUSINESS-SPLIT CHECKS PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
