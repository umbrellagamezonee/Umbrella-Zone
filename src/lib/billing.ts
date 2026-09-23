import type { Bill, CanteenOrder, Expense, MenuCategory, MenuItem, PaymentMethod } from "../types";
import { normalizeName } from "./customerName";
import { isCreditSettlement } from "./billLabel";
import { toDateInputValue, formatDateKey } from "./format";

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

// Canteen menu category -> the sheet/section name each report groups it
// under. The single place this mapping is defined — Reports' monthly sheets
// and Settings' full export both read it, so a menu category never drifts
// out of sync between the two.
export const REPORT_CATEGORIES: { sheet: string; categoryName: string }[] = [
  { sheet: "Food collection", categoryName: "Kitchen" },
  { sheet: "Cigarette collection", categoryName: "Cigarettes" },
  { sheet: "Drinks collection", categoryName: "Fridge" },
  { sheet: "Chocolate collection", categoryName: "Chocolate" },
];

export interface CategoryItemRow {
  id: string;
  name: string;
  price: number;
  costPrice: number | null;
  marginPerUnit: number | null;
  qtySold: number;
  revenue: number;
  remainingQty: number | null;
  remainingValue: number | null;
}

export interface CategoryStockProfit {
  sheet: string;
  categoryName: string;
  sale: number;
  purchase: number;
  profit: number;
  remaining: number;
  itemCount: number;
  itemRows: CategoryItemRow[];
}

// Per-canteen-category stock tracking: how much of each item sold (from
// every order ever placed, not bucketed by month — stock bought last month
// and sold this month, or vice versa, is still one continuous ledger, the
// same way a shopkeeper's own stock book never resets on the 1st), how much
// was spent restocking it (from Settings → Expenses, matched by category),
// and the resulting profit. "Sale" reads every order regardless of whether
// it was ever billed, matching how much has actually left the shelf.
export function categoryStockProfit(
  orders: CanteenOrder[],
  expenses: Expense[],
  menuItems: MenuItem[],
  menuCategories: MenuCategory[]
): CategoryStockProfit[] {
  const expenseFor = (category: string) =>
    expenses.filter((e) => e.category === category).reduce((s, e) => s + e.amount, 0);

  return REPORT_CATEGORIES.map((rc) => {
    const catId = menuCategories.find((c) => c.name === rc.categoryName)?.id;
    const catItems = menuItems.filter((i) => i.categoryId === catId);
    const itemRows: CategoryItemRow[] = catItems.map((item) => {
      let qtySold = 0;
      for (const order of orders) {
        const line = order.items.find((i) => i.menuItemId === item.id);
        if (line) qtySold += line.qty;
      }
      const revenue = qtySold * item.price;
      const marginPerUnit = item.costPrice != null ? item.price - item.costPrice : null;
      const remainingQty = item.stockQty;
      const remainingValue = remainingQty != null ? remainingQty * item.price : null;
      return {
        id: item.id,
        name: item.name,
        price: item.price,
        costPrice: item.costPrice,
        marginPerUnit,
        qtySold,
        revenue,
        remainingQty,
        remainingValue,
      };
    });
    const sale = itemRows.reduce((s, r) => s + r.revenue, 0);
    const remaining = itemRows.reduce((s, r) => s + (r.remainingValue ?? 0), 0);
    const purchase = expenseFor(rc.sheet.replace(" collection", ""));
    return { ...rc, sale, purchase, profit: sale - purchase, remaining, itemCount: catItems.length, itemRows };
  });
}

export interface DailyCollectionRow {
  Date: string;
  Item: string;
  "Total collection": number | string;
  Cash: number | string;
  Account: number | string;
  [key: string]: string | number;
}

// Day-by-day cash/account breakdown, one block per date — what the owner
// hands to their accountant: for each day, how much of each table's and
// each canteen category's collection came in as cash vs account.
// "Collection" here is cash+account actually received, same as everywhere
// else — money still on credit isn't counted until it's actually paid.
//
// A bill's cash/account split is recorded once for the whole bill, not per
// line item, so it's prorated across table charge and canteen charge by
// their own combined face value (not the bill's total, which already has
// any discount taken out — prorating against total would attribute more
// cash+account to the two parts than was actually collected on a
// discounted bill). Canteen money is prorated a second time across
// categories by each item's own share of that bill's food total, matched
// to its menu category by name. A split (shares) bill instead reads each
// payer's own recorded method directly, since that was actually chosen per
// share, not assumed from a ratio. A credit settlement (paying off an
// older, already-billed debt) has no way to know which table or category
// that original debt was for, so it's counted as cash collected on its own
// date under its own "Credit settlement" row rather than guessed at.
//
// A table/category that a bill merely touched but nothing was actually
// collected for yet (still fully on credit) doesn't get a row at all — a
// table played on 5 days out of 20 doesn't need 15 rows of zeros saying so.
export function dailyCollectionRows(
  bills: Bill[],
  menuItems: MenuItem[],
  menuCategories: MenuCategory[],
  orderedTablesList: { name: string }[]
): DailyCollectionRow[] {
  const round = (n: number) => Math.round(n * 100) / 100;

  const catIdToLabel = new Map<string, string>();
  for (const rc of REPORT_CATEGORIES) {
    const catId = menuCategories.find((c) => c.name === rc.categoryName)?.id;
    if (catId) catIdToLabel.set(catId, rc.sheet.replace(" collection", ""));
  }
  const itemNameToCatId = new Map<string, string>();
  for (const item of menuItems) itemNameToCatId.set(item.name.trim().toLowerCase(), item.categoryId);

  type Bucket = { total: number; cash: number; upi: number };
  const newBucket = (): Bucket => ({ total: 0, cash: 0, upi: 0 });
  const addTo = (b: Bucket, cash: number, upi: number) => {
    b.cash += cash;
    b.upi += upi;
    b.total += cash + upi;
  };
  const dailyTables = new Map<string, Map<string, Bucket>>();
  const dailyCategories = new Map<string, Map<string, Bucket>>();
  const bucketFor = (map: Map<string, Map<string, Bucket>>, dateKey: string, key: string) => {
    if (!map.has(dateKey)) map.set(dateKey, new Map());
    const dayMap = map.get(dateKey)!;
    if (!dayMap.has(key)) dayMap.set(key, newBucket());
    return dayMap.get(key)!;
  };

  for (const bill of bills) {
    if (bill.status === "cancelled") continue;
    const dateKey = toDateInputValue(bill.createdAt);

    if (isCreditSettlement(bill)) {
      addTo(bucketFor(dailyCategories, dateKey, "Credit settlement"), bill.amountCash, bill.amountUpi);
      continue;
    }

    const rawSum = bill.tableCharge + bill.canteenCharge;

    if (bill.tableId && bill.tableName) {
      const tBucket = bucketFor(dailyTables, dateKey, bill.tableName);
      if (bill.shares) {
        for (const s of bill.shares) {
          if (s.status !== "paid" || s.label !== "Table charge" || !s.paymentMethod) continue;
          addTo(tBucket, s.paymentMethod === "cash" ? s.amount : 0, s.paymentMethod === "upi" ? s.amount : 0);
        }
      } else if (rawSum > 0 && bill.tableCharge > 0) {
        const frac = bill.tableCharge / rawSum;
        addTo(tBucket, bill.amountCash * frac, bill.amountUpi * frac);
      }
    }

    if (bill.canteenCharge > 0 && bill.canteenItems.length > 0) {
      let canteenCash = 0;
      let canteenUpi = 0;
      if (bill.shares) {
        for (const s of bill.shares) {
          if (s.status !== "paid" || s.label === "Table charge" || !s.paymentMethod) continue;
          if (s.paymentMethod === "cash") canteenCash += s.amount;
          else if (s.paymentMethod === "upi") canteenUpi += s.amount;
        }
      } else if (rawSum > 0) {
        const frac = bill.canteenCharge / rawSum;
        canteenCash = bill.amountCash * frac;
        canteenUpi = bill.amountUpi * frac;
      }
      for (const item of bill.canteenItems) {
        const revenue = item.price * item.qty;
        if (revenue <= 0) continue;
        const itemFrac = revenue / bill.canteenCharge;
        const catId = itemNameToCatId.get(item.name.trim().toLowerCase());
        const label = (catId && catIdToLabel.get(catId)) || "Other";
        addTo(bucketFor(dailyCategories, dateKey, label), canteenCash * itemFrac, canteenUpi * itemFrac);
      }
    }
  }

  const dateKeys = [...new Set([...dailyTables.keys(), ...dailyCategories.keys()])].sort();
  const categoryOrder = [...REPORT_CATEGORIES.map((rc) => rc.sheet.replace(" collection", "")), "Other", "Credit settlement"];
  const rows: DailyCollectionRow[] = [];
  for (const dateKey of dateKeys) {
    const label = formatDateKey(dateKey, { day: "numeric", month: "long" });
    let dayTotal = newBucket();
    const tableMap = dailyTables.get(dateKey);
    for (const t of orderedTablesList) {
      const b = tableMap?.get(t.name);
      if (!b || b.total === 0) continue;
      rows.push({ Date: label, Item: t.name, "Total collection": round(b.total), Cash: round(b.cash), Account: round(b.upi) });
      dayTotal = { total: dayTotal.total + b.total, cash: dayTotal.cash + b.cash, upi: dayTotal.upi + b.upi };
    }
    const catMap = dailyCategories.get(dateKey);
    for (const label2 of categoryOrder) {
      const b = catMap?.get(label2);
      if (!b || b.total === 0) continue;
      rows.push({ Date: label, Item: label2, "Total collection": round(b.total), Cash: round(b.cash), Account: round(b.upi) });
      dayTotal = { total: dayTotal.total + b.total, cash: dayTotal.cash + b.cash, upi: dayTotal.upi + b.upi };
    }
    rows.push({ Date: label, Item: "Total", "Total collection": round(dayTotal.total), Cash: round(dayTotal.cash), Account: round(dayTotal.upi) });
    rows.push({ Date: "", Item: "", "Total collection": "", Cash: "", Account: "" });
  }
  return rows;
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
