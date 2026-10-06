import type { Bill, CanteenOrder, Customer, Expense, MenuCategory, MenuItem, PaymentMethod } from "../types";
import { normalizeName } from "./customerName";
import { isCreditSettlement, settlementPersonName } from "./billLabel";
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

interface DailyTotals {
  dateKey: string;
  cash: number;
  upi: number;
  credit: number;
  issued: number;
  // Cash/account that landed on this date under "Credit settlement" — a
  // settlement that couldn't be traced back onto an earlier row in this report.
  untracedCash: number;
  untracedUpi: number;
  // Credit given that day, person by person.
  people: Map<string, { issued: number; pending: number }>;
  // See moveMoney: cash/account that arrived this day but is counted on
  // another day's figures, and the reverse.
  movedOutCash: number;
  movedOutUpi: number;
  movedInCash: number;
  movedInUpi: number;
  // One entry per table / canteen category that had billing or money that
  // day, in the same order the Daily collection rows print them.
  items: { item: string; cash: number; upi: number; issued: number; pending: number }[];
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
// now, not a frozen snapshot of billing day. Tracing always covers the whole
// history, so a given day shows the same figures whichever dates the report
// is run for; a settlement whose charge can't be found at all (an advance,
// or a debt that was never recorded) stays under "Credit settlement" on its
// own date. "Credit from" lists whoever still owes whatever's left of a
// row's Credit figure, so it doesn't need to be looked up elsewhere.
//
// A table/category that a bill merely touched but nothing was actually
// billed or collected for yet doesn't get a row at all — a table played on
// 5 days out of 20 doesn't need 15 rows of zeros saying so.
//
// Needs every bill ever recorded (not just this report's range) so a debt
// created before the range, or a settlement clearing one from before it,
// still gets matched up correctly. rangeStartMs/rangeEndMs (default: no
// limit, the whole history) only control which dates' rows actually get
// printed.
//
// Credit means exactly what the app's own credit balance means: only a bill
// that's actually paid counts (a stuck-open bill, or a split bill's credit
// share while the bill is still open, isn't credit yet), and a customer who
// paid ahead of being owed anything has that advance netted against their
// next charge.
export function dailyCollectionRows(
  allBills: Bill[],
  menuItems: MenuItem[],
  menuCategories: MenuCategory[],
  orderedTablesList: { name: string }[],
  customers: Customer[],
  rangeStartMs = -Infinity,
  rangeEndMs = Infinity
): DailyCollectionRow[] {
  return buildDailyCollection(
    allBills,
    menuItems,
    menuCategories,
    orderedTablesList,
    customers,
    rangeStartMs,
    rangeEndMs
  ).rows;
}

function buildDailyCollection(
  allBills: Bill[],
  menuItems: MenuItem[],
  menuCategories: MenuCategory[],
  orderedTablesList: { name: string }[],
  customers: Customer[],
  rangeStartMs: number,
  rangeEndMs: number
): { rows: DailyCollectionRow[]; days: DailyTotals[] } {
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
    // Credit originally given on this row, before any settlement was traced
    // back onto it — `credit` is what's still owed, `issued - credit` is how
    // much of it has since been paid off (see creditHisaab).
    issued: number;
    creditByCustomer: Map<string, number>;
    // Same split of `issued`, by who took the credit — so a day's credit can
    // be listed person by person (given / since paid / still owed).
    issuedByCustomer: Map<string, number>;
  };
  const newBucket = (): Bucket => ({
    total: 0,
    cash: 0,
    upi: 0,
    credit: 0,
    issued: 0,
    creditByCustomer: new Map(),
    issuedByCustomer: new Map(),
  });
  const addTo = (b: Bucket, cash: number, upi: number, credit: number, customerName?: string) => {
    b.cash += cash;
    b.upi += upi;
    b.credit += credit;
    b.issued += credit;
    b.total += cash + upi;
    if (credit > 0.005 && customerName) {
      b.creditByCustomer.set(customerName, (b.creditByCustomer.get(customerName) ?? 0) + credit);
      b.issuedByCustomer.set(customerName, (b.issuedByCustomer.get(customerName) ?? 0) + credit);
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

  // A customer who pays before anything is owed (or pays more than they
  // owed) is sitting on an advance. The app's own balance nets it against
  // their NEXT charge, so this does too — otherwise a later bill would look
  // like fresh credit here while the Credits page already shows it cleared.
  // Until that happens the money stays on the settlement's own date.
  type Advance = { bucket: Bucket; dateKey: string; cash: number; upi: number; amount: number };
  const advances = new Map<string, Advance[]>();

  // A payment that clears another day's credit is counted back on THAT day,
  // so a day's "bills" cash/account differs from what physically came in that
  // day by exactly two things: money that arrived today but is counted on
  // another day (movedOut), and money that arrived on another day but is
  // counted today (movedIn). Kept per date so a screen can show that bridge
  // instead of two unexplained numbers.
  type Flow = { outCash: number; outUpi: number; inCash: number; inUpi: number };
  const flows = new Map<string, Flow>();
  const flowFor = (key: string) => {
    if (!flows.has(key)) flows.set(key, { outCash: 0, outUpi: 0, inCash: 0, inUpi: 0 });
    return flows.get(key)!;
  };
  const moveMoney = (arrivedOn: string, countedOn: string, cash: number, upi: number) => {
    if (arrivedOn === countedOn) return;
    const out = flowFor(arrivedOn);
    out.outCash += cash;
    out.outUpi += upi;
    const into = flowFor(countedOn);
    into.inCash += cash;
    into.inUpi += upi;
  };
  const pushChunk = (key: string, chunk: DebtChunk) => {
    const queue = queueFor(key);
    queue.push(chunk);
    const pool = advances.get(key);
    if (!pool) return;
    while (chunk.remaining > 0.005 && pool.length > 0) {
      const adv = pool[0];
      const take = Math.min(adv.amount, chunk.remaining);
      const frac = take / adv.amount;
      const takeCash = adv.cash * frac;
      const takeUpi = adv.upi * frac;
      moveMoney(adv.dateKey, toDateInputValue(chunk.date), takeCash, takeUpi);
      for (const part of chunk.parts) {
        const partFrac = chunk.total > 0 ? part.amount / chunk.total : 0;
        const partTake = take * partFrac;
        part.bucket.credit = Math.max(0, part.bucket.credit - partTake);
        const prevByCustomer = part.bucket.creditByCustomer.get(part.customerName) ?? 0;
        part.bucket.creditByCustomer.set(part.customerName, Math.max(0, prevByCustomer - partTake));
        part.bucket.cash += takeCash * partFrac;
        part.bucket.upi += takeUpi * partFrac;
        part.bucket.total += (takeCash + takeUpi) * partFrac;
      }
      adv.bucket.cash -= takeCash;
      adv.bucket.upi -= takeUpi;
      adv.bucket.total -= takeCash + takeUpi;
      adv.amount -= take;
      adv.cash -= takeCash;
      adv.upi -= takeUpi;
      chunk.remaining -= take;
      if (adv.amount <= 0.005) pool.shift();
    }
    if (chunk.remaining <= 0.005) queue.pop();
  };

  const sorted = allBills
    .filter((b) => b.status !== "cancelled")
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const bill of sorted) {
    const dateKey = toDateInputValue(bill.createdAt);

    // A non-split bill nobody has settled yet (checkout started, no payment
    // method ever picked) hasn't turned into cash, account or credit — the
    // app lists it under what's still pending instead (see customerOpenBills),
    // not as credit.
    if (!bill.shares && bill.status !== "paid") continue;

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
        moveMoney(dateKey, toDateInputValue(chunk.date), takeCash, takeUpi);
        for (const part of chunk.parts) {
          const partFrac = chunk.total > 0 ? part.amount / chunk.total : 0;
          const partTake = take * partFrac;
          part.bucket.credit = Math.max(0, part.bucket.credit - partTake);
          const prevByCustomer = part.bucket.creditByCustomer.get(part.customerName) ?? 0;
          part.bucket.creditByCustomer.set(part.customerName, Math.max(0, prevByCustomer - partTake));
          part.bucket.cash += takeCash * partFrac;
          part.bucket.upi += takeUpi * partFrac;
          part.bucket.total += (takeCash + takeUpi) * partFrac;
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
        const bucket = bucketFor(dailyCategories, dateKey, "Credit settlement");
        addTo(bucket, cashPool * frac, upiPool * frac, 0);
        const pool = advances.get(key) ?? [];
        pool.push({ bucket, dateKey, cash: cashPool * frac, upi: upiPool * frac, amount: left });
        advances.set(key, pool);
      }
      continue;
    }

    const rawSum = bill.tableCharge + bill.canteenCharge;

    if (bill.shares) {
      for (const s of bill.shares) {
        if (s.status !== "paid" || !s.paymentMethod) continue;
        const cash = s.paymentMethod === "cash" ? s.amount : 0;
        const upi = s.paymentMethod === "upi" ? s.amount : 0;
        // A credit share on a split bill that's still open isn't on anyone's
        // credit balance yet (creditBalanceFor only counts paid bills), so it
        // isn't counted here either until the bill closes.
        const credit = s.paymentMethod === "credit" && bill.status === "paid" ? s.amount : 0;
        const pushShareChunk = (parts: ChunkPart[]) => {
          const total = parts.reduce((x, p) => x + p.amount, 0);
          if (total > 0.005) {
            pushChunk(keyForName(s.payerName), { date: bill.createdAt, remaining: total, total, parts });
          }
        };
        if (s.label === "Table charge") {
          if (!bill.tableId || !bill.tableName) continue;
          const bucket = bucketFor(dailyTables, dateKey, bill.tableName);
          addTo(bucket, cash, upi, credit, s.payerName);
          if (credit > 0.005) pushShareChunk([{ bucket, amount: credit, customerName: s.payerName }]);
          continue;
        }
        const itemName = s.label.replace(/\s+x\d+$/, "");
        const billItems = bill.canteenItems.filter((i) => i.price * i.qty > 0);
        const itemsRevenue = billItems.reduce((x, i) => x + i.price * i.qty, 0);
        // A share named after one item — straight into that item's category.
        const namedAfterItem = itemNameToCatId.has(itemName.trim().toLowerCase());
        // Otherwise the label is generic, not an item name: "Food" (a table
        // bill's canteen part, covering everything ordered) or an older
        // "Share" (a payer's cut of the whole bill, table and food). Looking
        // those up as item names dumped them all under "Other" — spread them
        // over what the bill actually contained instead, the same way a
        // non-split bill's money is: table vs food by face value, food across
        // items by each one's share of the food total.
        const isFoodShare = /^food$/i.test(itemName.trim());
        const tableWeight =
          !isFoodShare && bill.tableId && bill.tableName && bill.tableCharge > 0 ? bill.tableCharge : 0;
        const canteenWeight = itemsRevenue > 0 && bill.canteenCharge > 0 ? bill.canteenCharge : 0;
        const totalWeight = tableWeight + canteenWeight;
        if (namedAfterItem || totalWeight <= 0) {
          const bucket = bucketFor(dailyCategories, dateKey, categoryLabelFor(itemName));
          addTo(bucket, cash, upi, credit, s.payerName);
          if (credit > 0.005) pushShareChunk([{ bucket, amount: credit, customerName: s.payerName }]);
        } else {
          const parts: ChunkPart[] = [];
          const put = (bucket: Bucket, frac: number) => {
            const partCredit = credit * frac;
            addTo(bucket, cash * frac, upi * frac, partCredit, s.payerName);
            if (partCredit > 0.005) parts.push({ bucket, amount: partCredit, customerName: s.payerName });
          };
          if (tableWeight > 0) put(bucketFor(dailyTables, dateKey, bill.tableName!), tableWeight / totalWeight);
          if (canteenWeight > 0) {
            for (const item of billItems) {
              const frac = ((item.price * item.qty) / itemsRevenue) * (canteenWeight / totalWeight);
              put(bucketFor(dailyCategories, dateKey, categoryLabelFor(item.name)), frac);
            }
          }
          pushShareChunk(parts);
        }
      }
      continue;
    }

    const customerName =
      customers.find((c) => c.id === bill.customerId)?.name ?? settlementPersonName(bill, undefined);
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
      if (total > 0.005) pushChunk(bill.customerId, { date: bill.createdAt, remaining: total, total, parts: chunkParts });
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
  const days: DailyTotals[] = [];
  const listedTables = new Set(uniqueTables.map((t) => t.name));
  for (const dateKey of dateKeys) {
    const label = formatDateKey(dateKey, { day: "numeric", month: "long" });
    const dayTotal = newBucket();
    const people = new Map<string, { issued: number; pending: number }>();
    const items: DailyTotals["items"] = [];
    const addItem = (name: string, b: Bucket) => {
      if (b.issued > 0.005 || !isEmpty(b)) items.push({ item: name, cash: b.cash, upi: b.upi, issued: b.issued, pending: b.credit });
    };
    const countPeople = (b: Bucket) => {
      for (const [name, amt] of b.issuedByCustomer) {
        const cur = people.get(name) ?? { issued: 0, pending: 0 };
        cur.issued += amt;
        people.set(name, cur);
      }
      for (const [name, amt] of b.creditByCustomer) {
        const cur = people.get(name) ?? { issued: 0, pending: 0 };
        cur.pending += amt;
        people.set(name, cur);
      }
    };
    const tableMap = dailyTables.get(dateKey);
    // A table that's since been deleted from the list still has real
    // billing on its dates — print it after the current ones rather than
    // leaving its money out of the day's total.
    const removedTables = [...(tableMap?.keys() ?? [])].filter((name) => !listedTables.has(name)).sort();
    for (const t of [...uniqueTables, ...removedTables.map((name) => ({ name }))]) {
      const b = tableMap?.get(t.name);
      // Credit given on a row that's since been wiped out entirely by a
      // discount has no cash and nothing left owed — nothing to print, but it
      // was still given, and the day's "credit diya" has to include it.
      if (b) {
        dayTotal.issued += b.issued;
        countPeople(b);
        addItem(t.name, b);
      }
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
      if (b) {
        dayTotal.issued += b.issued;
        countPeople(b);
        addItem(label2, b);
      }
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
    const untraced = catMap?.get("Credit settlement");
    days.push({
      dateKey,
      cash: dayTotal.cash,
      upi: dayTotal.upi,
      credit: dayTotal.credit,
      issued: dayTotal.issued,
      untracedCash: untraced?.cash ?? 0,
      untracedUpi: untraced?.upi ?? 0,
      people,
      movedOutCash: flows.get(dateKey)?.outCash ?? 0,
      movedOutUpi: flows.get(dateKey)?.outUpi ?? 0,
      movedInCash: flows.get(dateKey)?.inCash ?? 0,
      movedInUpi: flows.get(dateKey)?.inUpi ?? 0,
      items,
    });
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
  // A day on which money arrived but ALL of it was counted back on earlier
  // days (someone only paid off old credit) has no billing of its own, so no
  // rows above — but it still needs an entry so its bridge to the galla shows.
  const printed = new Set(dateKeys);
  for (const [dateKey, f] of flows) {
    if (printed.has(dateKey)) continue;
    const ms = dateInputValueToIstMidnight(dateKey);
    if (ms < rangeStartMs || ms >= rangeEndMs) continue;
    days.push({
      dateKey,
      cash: 0,
      upi: 0,
      credit: 0,
      issued: 0,
      untracedCash: 0,
      untracedUpi: 0,
      people: new Map(),
      movedOutCash: f.outCash,
      movedOutUpi: f.outUpi,
      movedInCash: f.inCash,
      movedInUpi: f.inUpi,
      items: [],
    });
  }
  days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return { rows, days };
}

// One line per date for the plain "Credit hisaab" sheet and the PDF built
// from it: how much of that day's billing came in as cash and as account
// (a credit paid off later already counted back on the day it was charged),
// how much credit was given that day, how much of THAT credit has since been
// paid off (cash + account + any discount given), and what's still owed. Per
// line, diya - settle = baaki, and the three totals at the bottom add up the
// same way — so total credit given, minus total settled, is exactly what's
// still pending, with nothing else to reconcile. It comes from the very same
// pass as dailyCollectionRows, so it can't disagree with the Daily
// collection / Din ka hisaab figures for the same day.
export interface CreditHisaabDay {
  dateKey: string;
  label: string;
  cash: number;
  upi: number;
  issued: number;
  settled: number;
  pending: number;
  // Part of cash/upi above that came from a settlement whose original charge
  // isn't in this report (older than its range, or never recorded).
  untracedCash: number;
  untracedUpi: number;
  // Who took the credit given that day: how much, how much of it has since
  // been paid off, and what they still owe from it. Adds up to the day's
  // issued / settled / pending above.
  people: { name: string; issued: number; settled: number; pending: number }[];
  // What physically came into the galla that day (the Galla Summary figures).
  // cash/upi above are that day's BILLS' figures instead, so:
  //   gallaCash = cash + movedOutCash - movedInCash   (same for account)
  // movedOut = money that arrived this day but is counted on another day's
  // figures; movedIn = money that arrived on another day but is counted here.
  gallaCash: number;
  gallaUpi: number;
  movedOutCash: number;
  movedOutUpi: number;
  movedInCash: number;
  movedInUpi: number;
  // The day split by table / canteen category: cash, account, credit given
  // and still owed — adds up to the day's cash / upi / issued / pending.
  items: { item: string; cash: number; upi: number; issued: number; pending: number }[];
}

export interface CreditHisaab {
  days: CreditHisaabDay[];
  total: {
    cash: number;
    upi: number;
    issued: number;
    settled: number;
    pending: number;
    untracedCash: number;
    untracedUpi: number;
    gallaCash: number;
    gallaUpi: number;
  };
}

export function creditHisaab(
  allBills: Bill[],
  menuItems: MenuItem[],
  menuCategories: MenuCategory[],
  orderedTablesList: { name: string }[],
  customers: Customer[],
  rangeStartMs = -Infinity,
  rangeEndMs = Infinity
): CreditHisaab {
  const round = (n: number) => Math.round(n * 100) / 100;
  const { days } = buildDailyCollection(
    allBills,
    menuItems,
    menuCategories,
    orderedTablesList,
    customers,
    rangeStartMs,
    rangeEndMs
  );
  const galla = gallaByDate(allBills);
  const out: CreditHisaabDay[] = days.map((d) => ({
    dateKey: d.dateKey,
    label: formatDateKey(d.dateKey, { day: "numeric", month: "long" }),
    cash: round(d.cash),
    upi: round(d.upi),
    issued: round(d.issued),
    settled: round(d.issued - d.credit),
    pending: round(d.credit),
    untracedCash: round(d.untracedCash),
    untracedUpi: round(d.untracedUpi),
    people: [...d.people.entries()]
      .map(([name, v]) => ({
        name,
        issued: round(v.issued),
        settled: round(v.issued - v.pending),
        pending: round(v.pending),
      }))
      .filter((x) => x.issued > 0.005 || x.pending > 0.005)
      .sort((a, b) => b.pending - a.pending || b.issued - a.issued || a.name.localeCompare(b.name)),
    gallaCash: round((galla.get(d.dateKey)?.freshCash ?? 0) + (galla.get(d.dateKey)?.settledCash ?? 0)),
    gallaUpi: round((galla.get(d.dateKey)?.freshUpi ?? 0) + (galla.get(d.dateKey)?.settledUpi ?? 0)),
    movedOutCash: round(d.movedOutCash),
    movedOutUpi: round(d.movedOutUpi),
    movedInCash: round(d.movedInCash),
    movedInUpi: round(d.movedInUpi),
    items: d.items.map((x) => ({
      item: x.item,
      cash: round(x.cash),
      upi: round(x.upi),
      issued: round(x.issued),
      pending: round(x.pending),
    })),
  }));
  const sum = (f: (d: CreditHisaabDay) => number) => round(out.reduce((s, d) => s + f(d), 0));
  return {
    days: out,
    total: {
      cash: sum((d) => d.cash),
      upi: sum((d) => d.upi),
      issued: sum((d) => d.issued),
      settled: sum((d) => d.settled),
      pending: sum((d) => d.pending),
      untracedCash: sum((d) => d.untracedCash),
      untracedUpi: sum((d) => d.untracedUpi),
      gallaCash: sum((d) => d.gallaCash),
      gallaUpi: sum((d) => d.gallaUpi),
    },
  };
}

// The same thing as sheet rows, for both Excel exports: one line per date, a
// TOTAL line, then the three headline numbers spelled out in plain words.
export function creditHisaabSheetRows(h: CreditHisaab): Record<string, string | number>[] {
  // Two Cash/Account pairs, named so they can't be mixed up: the day's BILLS'
  // figures (a credit paid later is counted back on the day it was given) and
  // what actually came into the galla that day (the Galla Summary figures).
  const CASH = "Cash (us din ke bills ka)";
  const ACCOUNT = "Account (us din ke bills ka)";
  const G_CASH = "Galla Cash (us din aaya)";
  const G_ACCOUNT = "Galla Account (us din aaya)";
  const blank = {
    Date: "",
    [CASH]: "",
    [ACCOUNT]: "",
    "Credit diya": "",
    "Credit settle hua": "",
    "Credit baaki": "",
    [G_CASH]: "",
    [G_ACCOUNT]: "",
  };
  const rows: Record<string, string | number>[] = h.days.map((d) => ({
    Date: d.label,
    [CASH]: d.cash,
    [ACCOUNT]: d.upi,
    "Credit diya": d.issued,
    "Credit settle hua": d.settled,
    "Credit baaki": d.pending,
    [G_CASH]: d.gallaCash,
    [G_ACCOUNT]: d.gallaUpi,
  }));
  if (rows.length === 0) return rows;
  rows.push({
    Date: "TOTAL",
    [CASH]: h.total.cash,
    [ACCOUNT]: h.total.upi,
    "Credit diya": h.total.issued,
    "Credit settle hua": h.total.settled,
    "Credit baaki": h.total.pending,
    [G_CASH]: h.total.gallaCash,
    [G_ACCOUNT]: h.total.gallaUpi,
  });
  rows.push({ ...blank });
  rows.push({ ...blank, Date: "KUL HISAAB" });
  rows.push({ ...blank, Date: "Total credit diya", "Credit diya": h.total.issued });
  rows.push({ ...blank, Date: "Total credit settle hua (Cash + Account + maaf)", "Credit settle hua": h.total.settled });
  rows.push({ ...blank, Date: "Credit baaki (diya - settle)", "Credit baaki": h.total.pending });
  if (h.total.untracedCash + h.total.untracedUpi > 0.005) {
    rows.push({ ...blank });
    rows.push({
      ...blank,
      Date: "Note: purane credit / advance ka paisa (upar Cash/Account mein shaamil)",
      [CASH]: h.total.untracedCash,
      [ACCOUNT]: h.total.untracedUpi,
    });
  }
  rows.push({ ...blank });
  rows.push({
    ...blank,
    Date: "Cash/Account ke do set: pehla = us din ke bills ka hisaab (baad mein chuka credit usi din mein), aakhri do = us din asal mein galla mein aaya (Galla Summary jaisa).",
  });
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
  // cash + account + discount — what got cleared off their tab.
  amount: number;
  cash: number;
  upi: number;
  discount: number;
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
      const customerName = settlementPersonName(bill, customers.find((c) => c.id === bill.customerId));
      results.push({
        date: bill.createdAt,
        customerName,
        amount,
        cash: bill.amountCash,
        upi: bill.amountUpi,
        discount: bill.discount,
        oldestUnpaidSince: oldest,
      });
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

// What actually came into the galla on one date, kept in two parts so it's
// always clear where the money came from: the day's own bills, and someone
// paying off an older balance that day (a "credit settlement"). This is the
// "din ka paisa" view — real cash/account received that day, whichever
// day's charge it was for. dailyCollectionRows is the other view ("din ka
// hisaab") that counts a later settlement back on the day it was charged.
// The Galla Summary screen and the exported Galla sheet both read this one
// function, so they can't show different numbers for the same day.
export interface GallaDay {
  freshCash: number;
  freshUpi: number;
  settledCash: number;
  settledUpi: number;
  forgiven: number;
  settledCount: number;
  creditGiven: number;
}

export function gallaByDate(bills: Bill[]): Map<string, GallaDay> {
  const days = new Map<string, GallaDay>();
  for (const bill of bills) {
    if (bill.status === "cancelled") continue;
    const dateKey = toDateInputValue(bill.createdAt);
    let day = days.get(dateKey);
    if (!day) {
      day = { freshCash: 0, freshUpi: 0, settledCash: 0, settledUpi: 0, forgiven: 0, settledCount: 0, creditGiven: 0 };
      days.set(dateKey, day);
    }
    const m = billMoney(bill);
    if (isCreditSettlement(bill)) {
      if (bill.status !== "paid") continue;
      day.settledCash += m.cash;
      day.settledUpi += m.upi;
      day.forgiven += bill.discount;
      day.settledCount += 1;
    } else {
      day.freshCash += m.cash;
      day.freshUpi += m.upi;
      day.creditGiven += m.credit;
    }
  }
  return days;
}

export function gallaSummaryRows(
  bills: Bill[],
  rangeStartMs = -Infinity,
  rangeEndMs = Infinity
): Record<string, string | number>[] {
  const round = (n: number) => Math.round(n * 100) / 100;
  const days = gallaByDate(bills);
  const keys = [...days.keys()]
    .filter((k) => {
      const ms = dateInputValueToIstMidnight(k);
      return ms >= rangeStartMs && ms < rangeEndMs;
    })
    .sort();
  const rows: Record<string, string | number>[] = keys.map((k) => {
    const d = days.get(k)!;
    return {
      Date: formatDateKey(k, { day: "numeric", month: "long" }),
      "Naye bills - Cash": round(d.freshCash),
      "Naye bills - Account": round(d.freshUpi),
      "Credit settle - Cash": round(d.settledCash),
      "Credit settle - Account": round(d.settledUpi),
      "Total Cash": round(d.freshCash + d.settledCash),
      "Total Account": round(d.freshUpi + d.settledUpi),
      "Credit diya (naya)": round(d.creditGiven),
      "Credit maaf (discount)": round(d.forgiven),
      "Settle kitne": d.settledCount,
    };
  });
  if (rows.length === 0) return rows;
  const total = (key: string) => round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0));
  rows.push({
    Date: "TOTAL",
    "Naye bills - Cash": total("Naye bills - Cash"),
    "Naye bills - Account": total("Naye bills - Account"),
    "Credit settle - Cash": total("Credit settle - Cash"),
    "Credit settle - Account": total("Credit settle - Account"),
    "Total Cash": total("Total Cash"),
    "Total Account": total("Total Account"),
    "Credit diya (naya)": total("Credit diya (naya)"),
    "Credit maaf (discount)": total("Credit maaf (discount)"),
    "Settle kitne": total("Settle kitne"),
  });
  return rows;
}

// One customer's credit story in three numbers — how much they took on credit
// in total, how much they've paid back (cash + account + any discount), and
// what that leaves. Same rules as creditBalanceFor (paid bills only, a split
// bill's own shares matched by name), just kept in two parts so a list can
// show "diya" and "settle" next to each other. balance can go negative: that
// is a customer who paid more than they owed (an advance).
export function creditParts(bills: Bill[], customerId: string, nameKey: string): { given: number; settled: number; balance: number } {
  let given = 0;
  let settled = 0;
  for (const b of bills) {
    if (b.status !== "paid") continue;
    const matches = b.shares
      ? b.shares.some((s) => normalizeName(s.payerName) === nameKey)
      : b.customerId === customerId;
    if (!matches) continue;
    if (isCreditSettlement(b)) settled += b.amountPaid + b.discount;
    else given += personBillView(b, nameKey).onCredit;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { given: round(given), settled: round(settled), balance: round(given - settled) };
}

export interface CreditDueRow {
  customerId: string;
  name: string;
  phone: string;
  // Credit already on the books (bills that are paid/closed on credit, less
  // whatever's been settled). Negative when they've paid ahead.
  billed: number;
  // Food served but not yet billed, plus bills stuck open — real money owed,
  // just not on the credit ledger yet.
  notBilledYet: number;
  total: number;
}

export interface CreditOtherRow {
  name: string;
  amount: number;
}

export interface CreditPendingReport {
  // Everyone the Credits page lists, in its own order, with its own total.
  due: CreditDueRow[];
  dueBilled: number;
  dueNotBilledYet: number;
  dueTotal: number;
  // What those customers really owe on credit already billed — only those
  // actually owing (a customer who's paid ahead counts as 0, not as a minus).
  // Plus noProfileTotal this is the "Credit baaki" total of creditHisaab.
  owingBilled: number;
  // An advance sitting on a customer who ALSO has an unbilled order: the
  // Credits page nets the two, so its total is smaller by this much.
  advanceUsedOnPending: number;
  // owingBilled + noProfileTotal
  creditBaaki: number;
  // Credit still owed under a name with no customer profile (profile deleted,
  // walk-in, or a split-bill payer who was never added) — real money, but the
  // Credits page has no row to show it on.
  noProfile: CreditOtherRow[];
  noProfileTotal: number;
  // Everyone (customers and no-profile names alike) who paid more than they
  // owed — their balance is below zero, so they appear in no "owes" list.
  advance: CreditOtherRow[];
  advanceTotal: number;
  // Total credit given minus total settled over every paid bill, advances
  // included as minuses — creditBaaki - advanceTotal.
  netBilled: number;
  // A split bill's credit share that doesn't count until its bill closes.
  openSplitCredit: number;
}

export function creditPendingReport(bills: Bill[], customers: Customer[], orders: CanteenOrder[]): CreditPendingReport {
  const round = (n: number) => Math.round(n * 100) / 100;
  const live = bills.filter((b) => b.status !== "cancelled");
  const realCustomers = customers.filter((c) => !c.isWalkIn);

  const due: CreditDueRow[] = [];
  const advance: CreditOtherRow[] = [];
  let owingBilled = 0;
  let advanceUsedOnPending = 0;
  for (const c of realCustomers) {
    const billed = creditBalanceFor(live, c.id, normalizeName(c.name));
    const notBilledYet =
      customerPendingOrders(orders, bills, c.id).reduce((s, o) => s + orderTotal(o), 0) +
      customerOpenBills(live, c.id).reduce((s, b) => s + b.amountDue, 0);
    if (billed > 0) owingBilled += billed;
    if (billed > 0 || notBilledYet > 0) {
      if (billed < 0) advanceUsedOnPending += -billed;
      due.push({ customerId: c.id, name: c.name, phone: c.phone, billed, notBilledYet: round(notBilledYet), total: round(billed + notBilledYet) });
    }
    if (billed < -0.005) advance.push({ name: c.name, amount: round(-billed) });
  }
  due.sort((a, b) => b.total - a.total);

  // Everything left over: paid bills whose customer isn't one of the real
  // profiles above. A split-bill share belongs to whoever's NAME it carries,
  // so it only lands here when no real profile has that name.
  const isRealId = (id: string | null) => !!id && realCustomers.some((c) => c.id === id);
  const realNameKeys = new Set(realCustomers.map((c) => normalizeName(c.name)));
  const profileById = new Map(customers.map((c) => [c.id, c]));
  const noProfileBalance = new Map<string, { name: string; amount: number }>();
  const addNoProfile = (key: string, name: string, delta: number) => {
    const cur = noProfileBalance.get(key) ?? { name, amount: 0 };
    cur.amount += delta;
    noProfileBalance.set(key, cur);
  };
  const labelFor = (customerId: string | null, bill: Bill): { key: string; name: string } => {
    if (!customerId || customerId === "walk-in" || profileById.get(customerId)?.isWalkIn) {
      return { key: "none:walkin", name: "Walk-in / koi customer nahi" };
    }
    const named = !bill.tableId && bill.tableName && !isCreditSettlement(bill) ? bill.tableName : null;
    return {
      key: `deleted:${customerId}`,
      name: named ? `${named} (profile delete)` : `Delete hua profile #${customerId.slice(0, 4)}`,
    };
  };
  let openSplitCredit = 0;
  for (const b of live) {
    if (b.shares && b.status !== "paid") {
      for (const s of b.shares) {
        if (s.status === "paid" && s.paymentMethod === "credit") openSplitCredit += s.amount;
      }
      continue;
    }
    if (b.status !== "paid") continue;
    if (b.shares) {
      for (const s of b.shares) {
        if (s.status !== "paid" || s.paymentMethod !== "credit" || s.amount <= 0) continue;
        const nameKey = normalizeName(s.payerName);
        if (realNameKeys.has(nameKey)) continue;
        addNoProfile(`name:${nameKey}`, s.payerName, s.amount);
      }
      continue;
    }
    if (isRealId(b.customerId)) continue;
    const { key, name } = labelFor(b.customerId, b);
    if (isCreditSettlement(b)) addNoProfile(key, name, -(b.amountPaid + b.discount));
    else if (b.amountDue > 0) addNoProfile(key, name, b.amountDue);
  }
  const noProfile: CreditOtherRow[] = [];
  for (const { name, amount } of noProfileBalance.values()) {
    if (amount > 0.005) noProfile.push({ name, amount: round(amount) });
    else if (amount < -0.005) advance.push({ name, amount: round(-amount) });
  }
  noProfile.sort((a, b) => b.amount - a.amount);
  advance.sort((a, b) => b.amount - a.amount);

  const sum = (rows: { amount: number }[]) => round(rows.reduce((s, r) => s + r.amount, 0));
  const dueBilled = round(due.reduce((s, r) => s + r.billed, 0));
  const noProfileTotal = sum(noProfile);
  const advanceTotal = sum(advance);
  return {
    due,
    dueBilled,
    dueNotBilledYet: round(due.reduce((s, r) => s + r.notBilledYet, 0)),
    dueTotal: round(due.reduce((s, r) => s + r.total, 0)),
    owingBilled: round(owingBilled),
    advanceUsedOnPending: round(advanceUsedOnPending),
    creditBaaki: round(owingBilled + noProfileTotal),
    noProfile,
    noProfileTotal,
    advance,
    advanceTotal,
    netBilled: round(owingBilled + noProfileTotal - advanceTotal),
    openSplitCredit: round(openSplitCredit),
  };
}

// "Kiska credit baaki hai" as sheet rows, for both Excel exports: the same
// customers, in the same order, with the same totals as the Credits page,
// then whoever the Credits page can't show, anyone who's paid ahead, and the
// two short sums that tie this list to the Credit hisaab sheet's baaki and
// to the Credits page's own header total.
export function creditPendingSheetRows(r: CreditPendingReport): Record<string, string | number>[] {
  const COL_BILLED = "Credit baaki (bill ho chuka)";
  const COL_UNBILLED = "Serve hue, bill baaki";
  const COL_TOTAL = "Total baaki";
  const row = (name: string, billed: string | number, unbilled: string | number, total: string | number) => ({
    Naam: name,
    [COL_BILLED]: billed,
    [COL_UNBILLED]: unbilled,
    [COL_TOTAL]: total,
  });
  const blank = row("", "", "", "");
  const rows: Record<string, string | number>[] = [];
  for (const d of r.due) rows.push(row(d.name, d.billed, d.notBilledYet, d.total));
  rows.push(row("TOTAL (app ke Credits page jaisa)", r.dueBilled, r.dueNotBilledYet, r.dueTotal));

  if (r.noProfile.length > 0) {
    rows.push({ ...blank });
    rows.push(row("BINA PROFILE KE BAAKI (Credits page pe nahi dikhta)", "", "", ""));
    for (const n of r.noProfile) rows.push(row(n.name, n.amount, "", n.amount));
    rows.push(row("TOTAL (bina profile)", r.noProfileTotal, "", r.noProfileTotal));
  }
  if (r.advance.length > 0) {
    rows.push({ ...blank });
    rows.push(row("ADVANCE — inhone credit se zyada de diya (baaki nahi)", "", "", ""));
    for (const n of r.advance) rows.push(row(n.name, -n.amount, "", -n.amount));
    rows.push(row("TOTAL (advance)", -r.advanceTotal, "", -r.advanceTotal));
  }

  rows.push({ ...blank });
  rows.push(row("HISAAB MILAAN", "", "", ""));
  rows.push(row("Customers ka credit baaki (sirf jinka baaki hai)", "", "", r.owingBilled));
  rows.push(row("+ Bina profile ke baaki", "", "", r.noProfileTotal));
  rows.push(row("= KUL CREDIT BAAKI (Credit hisaab sheet ke baaki ke barabar)", "", "", r.creditBaaki));
  rows.push({ ...blank });
  rows.push(row("App ke Credits page ke total tak:", "", "", ""));
  rows.push(row("Customers ka credit baaki", "", "", r.owingBilled));
  rows.push(row("+ Serve hue, bill nahi bane", "", "", r.dueNotBilledYet));
  if (r.advanceUsedOnPending > 0.005) rows.push(row("- Advance jo inhi orders mein adjust hua", "", "", -r.advanceUsedOnPending));
  rows.push(row("= Credits page ka total", "", "", r.dueTotal));
  if (r.openSplitCredit > 0.005) {
    rows.push({ ...blank });
    rows.push(row("Note: split bill ka credit hissa (bill abhi open hai, band hone par judega)", "", "", r.openSplitCredit));
  }
  return rows;
}
