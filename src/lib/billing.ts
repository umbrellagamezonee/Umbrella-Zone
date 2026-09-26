import type { Bill, CanteenOrder, Customer, Expense, MenuCategory, MenuItem, PaymentMethod } from "../types";
import { normalizeName } from "./customerName";
import { isCreditSettlement } from "./billLabel";
import { toDateInputValue, formatDateKey, dateInputValueToIstMidnight } from "./format";

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
  lowStockThreshold: number;
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
        lowStockThreshold: item.lowStockThreshold,
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
  Credit: number | string;
  "Credit from": string;
  [key: string]: string | number;
}

// Day-by-day cash/account/credit breakdown, one block per date — what the
// owner hands to their accountant: for each day, how much of each table's
// and each canteen category's billing came in as cash, as account, and how
// much is still sitting on credit. "Total collection" is cash+account
// actually received, same as everywhere else — Credit is tracked
// separately, not folded into it, since it's money billed but not yet in
// hand.
//
// A bill's cash/account/credit split is recorded once for the whole bill,
// not per line item, so it's prorated across table charge and canteen
// charge by their own combined face value (not the bill's total, which
// already has any discount taken out — prorating against total would
// attribute more than was actually billed on a discounted bill). Canteen
// money is prorated a second time across categories by each item's own
// share of that bill's food total, matched to its menu category by name. A
// split (shares) bill instead reads each payer's own recorded method
// directly, since that was actually chosen per share, not assumed from a
// ratio — a still-pending share (nobody's decided how they're paying yet)
// counts toward none of the three, the same way it counts toward nothing
// today elsewhere in the app.
//
// A credit settlement (paying off an older, already-billed debt) gets
// traced back to whichever earlier charge(s) it actually cleared — oldest
// unpaid first, the same way a shopkeeper's khata naturally works — and its
// cash/account is added back onto THAT charge's own date/table/category
// row, with the same amount taken back off that row's Credit, instead of
// showing up as a separate "Credit settlement" row on the day it was
// actually paid. So a table played on the 22nd but only settled on the
// 25th shows as real cash on the 22nd once the report is regenerated after
// the 25th — this sheet always reflects where things stand as of right
// now, not a frozen snapshot of billing day. This only works when the
// original charge's own date falls inside this report's date range; a
// settlement clearing older debt from before the range keeps showing under
// "Credit settlement" on its own date instead, since there's no earlier row
// in THIS report to attach it to. "Credit from" lists whoever still owes
// whatever's left of a row's Credit figure, so it doesn't need to be looked
// up elsewhere.
//
// A table/category that a bill merely touched but nothing was actually
// billed or collected for yet doesn't get a row at all — a table played on
// 5 days out of 20 doesn't need 15 rows of zeros saying so.
//
// Needs every bill ever recorded (not just this report's range) so a debt
// created before the range, or a settlement clearing one from before it,
// still gets matched up correctly. rangeStartMs/rangeEndMs (default: no
// limit, the whole history) only control which dates' rows actually get
// printed, and how far back a settlement can reach to reattribute itself.
export function dailyCollectionRows(
  allBills: Bill[],
  menuItems: MenuItem[],
  menuCategories: MenuCategory[],
  orderedTablesList: { name: string }[],
  customers: Customer[],
  rangeStartMs = -Infinity,
  rangeEndMs = Infinity
): DailyCollectionRow[] {
  const round = (n: number) => Math.round(n * 100) / 100;

  const catIdToLabel = new Map<string, string>();
  for (const rc of REPORT_CATEGORIES) {
    const catId = menuCategories.find((c) => c.name === rc.categoryName)?.id;
    if (catId) catIdToLabel.set(catId, rc.sheet.replace(" collection", ""));
  }
  const itemNameToCatId = new Map<string, string>();
  for (const item of menuItems) itemNameToCatId.set(item.name.trim().toLowerCase(), item.categoryId);
  const categoryLabelFor = (itemName: string) => {
    const catId = itemNameToCatId.get(itemName.trim().toLowerCase());
    return (catId && catIdToLabel.get(catId)) || "Other";
  };

  type Bucket = {
    total: number;
    cash: number;
    upi: number;
    credit: number;
    creditByCustomer: Map<string, number>;
  };
  const newBucket = (): Bucket => ({ total: 0, cash: 0, upi: 0, credit: 0, creditByCustomer: new Map() });
  const addTo = (b: Bucket, cash: number, upi: number, credit: number, customerName?: string) => {
    b.cash += cash;
    b.upi += upi;
    b.credit += credit;
    b.total += cash + upi;
    if (credit > 0.005 && customerName) {
      b.creditByCustomer.set(customerName, (b.creditByCustomer.get(customerName) ?? 0) + credit);
    }
  };
  const dailyTables = new Map<string, Map<string, Bucket>>();
  const dailyCategories = new Map<string, Map<string, Bucket>>();
  const bucketFor = (map: Map<string, Map<string, Bucket>>, dateKey: string, key: string) => {
    if (!map.has(dateKey)) map.set(dateKey, new Map());
    const dayMap = map.get(dateKey)!;
    if (!dayMap.has(key)) dayMap.set(key, newBucket());
    return dayMap.get(key)!;
  };

  // One chunk per debt-creating charge — a whole non-split bill's due
  // amount, or one payer's own credit share of a split bill — remembering
  // which bucket(s) that charge landed in and how much of the chunk each
  // one is, so a later settlement can put money back exactly where it came
  // from instead of wherever the settlement itself happened to land.
  type ChunkPart = { bucket: Bucket; amount: number; customerName: string };
  type DebtChunk = { date: number; remaining: number; total: number; parts: ChunkPart[] };
  const queues = new Map<string, DebtChunk[]>();
  const queueFor = (key: string) => {
    if (!queues.has(key)) queues.set(key, []);
    return queues.get(key)!;
  };
  const keyForName = (name: string) => {
    const nameKey = normalizeName(name);
    return customers.find((c) => normalizeName(c.name) === nameKey)?.id ?? `name:${nameKey}`;
  };

  const sorted = allBills
    .filter((b) => b.status !== "cancelled")
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const bill of sorted) {
    const dateKey = toDateInputValue(bill.createdAt);

    if (isCreditSettlement(bill)) {
      const key = bill.customerId ?? `name:${normalizeName(bill.tableName ?? "")}`;
      const settleAmount = round(bill.amountPaid + bill.discount);
      if (settleAmount <= 0.005) continue;
      const queue = queueFor(key);
      const cashPool = bill.amountCash;
      const upiPool = bill.amountUpi;
      let left = settleAmount;
      while (left > 0.005 && queue.length > 0) {
        const chunk = queue[0];
        const take = Math.min(chunk.remaining, left);
        const chunkFrac = take / settleAmount;
        const takeCash = cashPool * chunkFrac;
        const takeUpi = upiPool * chunkFrac;
        const inRange = chunk.date >= rangeStartMs && chunk.date < rangeEndMs;
        for (const part of chunk.parts) {
          const partFrac = chunk.total > 0 ? part.amount / chunk.total : 0;
          const partTake = take * partFrac;
          if (inRange) {
            part.bucket.credit = Math.max(0, round(part.bucket.credit - partTake));
            const prevByCustomer = part.bucket.creditByCustomer.get(part.customerName) ?? 0;
            part.bucket.creditByCustomer.set(part.customerName, Math.max(0, round(prevByCustomer - partTake)));
            part.bucket.cash += takeCash * partFrac;
            part.bucket.upi += takeUpi * partFrac;
            part.bucket.total += (takeCash + takeUpi) * partFrac;
          } else {
            // The charge this is clearing is from before this report's own
            // range — nowhere in THIS report to trace it back to, so the
            // money still shows up, just under the settlement's own date
            // instead of disappearing.
            addTo(bucketFor(dailyCategories, dateKey, "Credit settlement"), takeCash * partFrac, takeUpi * partFrac, 0);
          }
        }
        chunk.remaining -= take;
        left -= take;
        if (chunk.remaining <= 0.005) queue.shift();
      }
      if (left > 0.005) {
        // More was settled than this customer's tracked debt covers — this
        // customer had a balance from before this data existed (or from a
        // bill that's since been deleted). Still real money, so it goes
        // under the settlement's own date rather than being dropped.
        const frac = left / settleAmount;
        addTo(bucketFor(dailyCategories, dateKey, "Credit settlement"), cashPool * frac, upiPool * frac, 0);
      }
      continue;
    }

    const rawSum = bill.tableCharge + bill.canteenCharge;

    if (bill.shares) {
      for (const s of bill.shares) {
        if (s.status !== "paid" || !s.paymentMethod) continue;
        const cash = s.paymentMethod === "cash" ? s.amount : 0;
        const upi = s.paymentMethod === "upi" ? s.amount : 0;
        const credit = s.paymentMethod === "credit" ? s.amount : 0;
        let bucket: Bucket;
        if (s.label === "Table charge") {
          if (!bill.tableId || !bill.tableName) continue;
          bucket = bucketFor(dailyTables, dateKey, bill.tableName);
        } else {
          const itemName = s.label.replace(/\s+x\d+$/, "");
          bucket = bucketFor(dailyCategories, dateKey, categoryLabelFor(itemName));
        }
        addTo(bucket, cash, upi, credit, s.payerName);
        if (credit > 0.005) {
          queueFor(keyForName(s.payerName)).push({
            date: bill.createdAt,
            remaining: credit,
            total: credit,
            parts: [{ bucket, amount: credit, customerName: s.payerName }],
          });
        }
      }
      continue;
    }

    const customerName = customers.find((c) => c.id === bill.customerId)?.name ?? "Unknown";
    const chunkParts: ChunkPart[] = [];

    if (bill.tableId && bill.tableName && bill.tableCharge > 0) {
      const tBucket = bucketFor(dailyTables, dateKey, bill.tableName);
      const frac = bill.tableCharge / rawSum;
      const credit = bill.amountDue * frac;
      addTo(tBucket, bill.amountCash * frac, bill.amountUpi * frac, credit, customerName);
      if (credit > 0.005) chunkParts.push({ bucket: tBucket, amount: credit, customerName });
    }

    if (bill.canteenCharge > 0 && bill.canteenItems.length > 0) {
      const canteenFrac = bill.canteenCharge / rawSum;
      const canteenCash = bill.amountCash * canteenFrac;
      const canteenUpi = bill.amountUpi * canteenFrac;
      const canteenCredit = bill.amountDue * canteenFrac;
      for (const item of bill.canteenItems) {
        const revenue = item.price * item.qty;
        if (revenue <= 0) continue;
        const itemFrac = revenue / bill.canteenCharge;
        const cBucket = bucketFor(dailyCategories, dateKey, categoryLabelFor(item.name));
        const credit = canteenCredit * itemFrac;
        addTo(cBucket, canteenCash * itemFrac, canteenUpi * itemFrac, credit, customerName);
        if (credit > 0.005) chunkParts.push({ bucket: cBucket, amount: credit, customerName });
      }
    }

    if (chunkParts.length > 0 && bill.customerId) {
      const total = chunkParts.reduce((s, p) => s + p.amount, 0);
      if (total > 0.005) queueFor(bill.customerId).push({ date: bill.createdAt, remaining: total, total, parts: chunkParts });
    }
  }

  const dateKeys = [...new Set([...dailyTables.keys(), ...dailyCategories.keys()])]
    .filter((k) => {
      const ms = dateInputValueToIstMidnight(k);
      return ms >= rangeStartMs && ms < rangeEndMs;
    })
    .sort();
  const categoryOrder = [...REPORT_CATEGORIES.map((rc) => rc.sheet.replace(" collection", "")), "Other", "Credit settlement"];
  // A device whose local table list has picked up a duplicate (a stale sync
  // artifact, not real cloud data) would otherwise print that table's row
  // twice on every date — de-duplicate by name so the report can't inherit
  // that regardless of why the list had one.
  const uniqueTables = [...new Map(orderedTablesList.map((t) => [t.name, t])).values()];
  const creditFromLabel = (b: Bucket) =>
    [...b.creditByCustomer.entries()]
      .filter(([, amt]) => amt > 0.5)
      .map(([name, amt]) => `${name} (${round(amt)})`)
      .join(", ");
  const isEmpty = (b: Bucket | undefined): b is undefined =>
    !b || (Math.abs(b.total) < 0.005 && Math.abs(b.credit) < 0.005);
  const rows: DailyCollectionRow[] = [];
  for (const dateKey of dateKeys) {
    const label = formatDateKey(dateKey, { day: "numeric", month: "long" });
    const dayTotal = newBucket();
    const tableMap = dailyTables.get(dateKey);
    for (const t of uniqueTables) {
      const b = tableMap?.get(t.name);
      if (isEmpty(b)) continue;
      rows.push({
        Date: label,
        Item: t.name,
        "Total collection": round(b.total),
        Cash: round(b.cash),
        Account: round(b.upi),
        Credit: round(b.credit),
        "Credit from": creditFromLabel(b),
      });
      dayTotal.total += b.total;
      dayTotal.cash += b.cash;
      dayTotal.upi += b.upi;
      dayTotal.credit += b.credit;
    }
    const catMap = dailyCategories.get(dateKey);
    for (const label2 of categoryOrder) {
      const b = catMap?.get(label2);
      if (isEmpty(b)) continue;
      rows.push({
        Date: label,
        Item: label2,
        "Total collection": round(b.total),
        Cash: round(b.cash),
        Account: round(b.upi),
        Credit: round(b.credit),
        "Credit from": creditFromLabel(b),
      });
      dayTotal.total += b.total;
      dayTotal.cash += b.cash;
      dayTotal.upi += b.upi;
      dayTotal.credit += b.credit;
    }
    rows.push({
      Date: label,
      Item: "Total",
      "Total collection": round(dayTotal.total),
      Cash: round(dayTotal.cash),
      Account: round(dayTotal.upi),
      Credit: round(dayTotal.credit),
      "Credit from": "",
    });
    rows.push({ Date: "", Item: "", "Total collection": "", Cash: "", Account: "", Credit: "", "Credit from": "" });
  }
  return rows;
}

export interface ItemPayment {
  cash: number;
  upi: number;
  credit: number;
}

// How much of each canteen item's money came in as cash, account, or is
// still on credit — only counted from a bill that ordered exactly that one
// canteen item, so the whole cash/account/credit amount belongs to it with
// no splitting needed. A bill with two or more different items has no
// honest way to say which rupee of a mixed cash+account payment was for
// which item, so those bills contribute nothing here at all rather than a
// guessed percentage split — an item that only ever sold alongside other
// things in the same order will show 0 here even with real Sold/Revenue
// elsewhere. Only a paid bill carries a real split, so an item still
// sitting in an unbilled open order has nothing here yet either. Bills only
// remember an item's name (not its menu item id), so two menu items
// sharing a name share one bucket here.
export function canteenItemPayments(bills: Bill[]): Map<string, ItemPayment> {
  const byName = new Map<string, ItemPayment>();
  const addTo = (name: string, cash: number, upi: number, credit: number) => {
    const b = byName.get(name) ?? { cash: 0, upi: 0, credit: 0 };
    b.cash += cash;
    b.upi += upi;
    b.credit += credit;
    byName.set(name, b);
  };
  for (const bill of bills) {
    if (bill.status === "cancelled" || isCreditSettlement(bill)) continue;
    if (bill.canteenCharge <= 0 || bill.canteenItems.length !== 1) continue;
    const item = bill.canteenItems[0];
    if (item.price * item.qty <= 0) continue;
    const rawSum = bill.tableCharge + bill.canteenCharge;
    let canteenCash = 0;
    let canteenUpi = 0;
    let canteenCredit = 0;
    if (bill.shares) {
      for (const s of bill.shares) {
        if (s.status !== "paid" || s.label === "Table charge" || !s.paymentMethod) continue;
        if (s.paymentMethod === "cash") canteenCash += s.amount;
        else if (s.paymentMethod === "upi") canteenUpi += s.amount;
        else if (s.paymentMethod === "credit") canteenCredit += s.amount;
      }
    } else if (rawSum > 0) {
      const frac = bill.canteenCharge / rawSum;
      canteenCash = bill.amountCash * frac;
      canteenUpi = bill.amountUpi * frac;
      canteenCredit = bill.amountDue * frac;
    }
    addTo(item.name, canteenCash, canteenUpi, canteenCredit);
  }
  return byName;
}

export interface CreditSettlementDetail {
  date: number;
  customerName: string;
  amount: number;
  oldestUnpaidSince: number | null;
}

// For every credit settlement (a customer paying down their running tab),
// how much they paid and the date of the oldest charge still unpaid right
// before this payment — a settlement is assumed to clear whatever's been
// owed the longest first, the same way a shopkeeper's own khata naturally
// works, since there's no record of which specific past charge a given
// rupee of settlement was actually for. This needs every bill a customer
// has ever had, not just the report's date range, since a settlement can
// be clearing debt from well before the range starts — the caller filters
// the returned rows down to the range afterward.
export function creditSettlementDetails(allBills: Bill[], customers: Customer[]): CreditSettlementDetail[] {
  type Debt = { date: number; remaining: number };
  const queues = new Map<string, Debt[]>();

  const queueFor = (key: string) => {
    if (!queues.has(key)) queues.set(key, []);
    return queues.get(key)!;
  };
  const consume = (queue: Debt[], amount: number): number | null => {
    const oldest = queue.length > 0 ? queue[0].date : null;
    let left = amount;
    while (left > 0.005 && queue.length > 0) {
      const chunk = queue[0];
      const take = Math.min(chunk.remaining, left);
      chunk.remaining -= take;
      left -= take;
      if (chunk.remaining <= 0.005) queue.shift();
    }
    return oldest;
  };

  const results: CreditSettlementDetail[] = [];
  const sorted = allBills
    .filter((b) => b.status === "paid")
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const bill of sorted) {
    if (isCreditSettlement(bill)) {
      const key = bill.customerId ?? `name:${normalizeName(bill.tableName ?? "")}`;
      const amount = Math.round((bill.amountPaid + bill.discount) * 100) / 100;
      if (amount <= 0) continue;
      const oldest = consume(queueFor(key), amount);
      const customerName = customers.find((c) => c.id === bill.customerId)?.name ?? bill.tableName ?? "Unknown";
      results.push({ date: bill.createdAt, customerName, amount, oldestUnpaidSince: oldest });
      continue;
    }
    if (bill.shares) {
      for (const s of bill.shares) {
        if (s.status !== "paid" || s.paymentMethod !== "credit" || s.amount <= 0) continue;
        const nameKey = normalizeName(s.payerName);
        const key = customers.find((c) => normalizeName(c.name) === nameKey)?.id ?? `name:${nameKey}`;
        queueFor(key).push({ date: bill.createdAt, remaining: s.amount });
      }
      continue;
    }
    if (bill.amountDue > 0 && bill.customerId) {
      queueFor(bill.customerId).push({ date: bill.createdAt, remaining: bill.amountDue });
    }
  }
  return results;
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
