import type { Bill, CanteenOrder, Customer, Expense, MenuCategory, MenuItem } from "../types";
import {
  REPORT_CATEGORIES,
  categoryStockProfit,
  creditHisaab,
  gallaByDate,
  type CreditHisaabDay,
  type GallaDay,
} from "./billing";
import { isCreditSettlement, settlementPersonName } from "./billLabel";
import { dateInputValueToIstMidnight, formatDateKey, formatTime, toDateInputValue } from "./format";

// Gaming (the tables) and Canteen (food, drinks, cigarettes, chocolate) are two
// separate businesses. For each row — a table, or a canteen category — and for
// each business as a whole:
//   billed   what was billed that day
//   cash/upi the Cash / Account that CAME IN that day for it (this is what is in
//            the galla), of which oldCash/oldUpi was an old credit being paid
//   issued   credit given that day (udhaar), pending = how much of that is
//            still unpaid
export interface BusinessRow {
  item: string;
  billed: number;
  cash: number;
  upi: number;
  oldCash: number;
  oldUpi: number;
  issued: number;
  pending: number;
}

export interface BusinessSum {
  billed: number;
  cash: number;
  upi: number;
  oldCash: number;
  oldUpi: number;
  issued: number;
  pending: number;
}

export interface BusinessDay {
  gaming: BusinessRow[];
  canteen: BusinessRow[];
  gamingTotal: BusinessSum;
  canteenTotal: BusinessSum;
  // Money that came in but could not be matched to any table or category (an
  // old credit with no record, or an advance) — still in the galla.
  other: { cash: number; upi: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// One day, split into the two businesses. Both the day screen and the month view
// read this, so their figures can never differ.
export function businessOfDay(d: CreditHisaabDay): BusinessDay {
  const rows = new Map<string, BusinessRow>();
  const key = (kind: string, item: string) => kind + ":" + item;
  const rowFor = (kind: "table" | "canteen", item: string): BusinessRow => {
    const k = key(kind, item);
    let r = rows.get(k);
    if (!r) {
      r = { item, billed: 0, cash: 0, upi: 0, oldCash: 0, oldUpi: 0, issued: 0, pending: 0 };
      rows.set(k, r);
    }
    return r;
  };
  const order: { kind: "table" | "canteen"; item: string }[] = [];
  for (const it of d.items) {
    if (it.kind === "other") continue;
    const r = rowFor(it.kind, it.item);
    r.billed += it.billed;
    r.issued += it.issued;
    r.pending += it.pending;
    order.push({ kind: it.kind, item: it.item });
  }
  const other = { cash: 0, upi: 0 };
  for (const x of d.received) {
    if (x.kind === "other") {
      other.cash += x.cash;
      other.upi += x.upi;
      continue;
    }
    if (!rows.has(key(x.kind, x.item))) order.push({ kind: x.kind, item: x.item });
    const r = rowFor(x.kind, x.item);
    r.cash += x.cash;
    r.upi += x.upi;
    r.oldCash += x.oldCash ?? 0;
    r.oldUpi += x.oldUpi ?? 0;
  }
  const pick = (kind: "table" | "canteen") => order.filter((o) => o.kind === kind).map((o) => rows.get(key(kind, o.item))!);
  const clean = (r: BusinessRow): BusinessRow => ({
    item: r.item,
    billed: r2(r.billed),
    cash: r2(r.cash),
    upi: r2(r.upi),
    oldCash: r2(r.oldCash),
    oldUpi: r2(r.oldUpi),
    issued: r2(r.issued),
    pending: r2(r.pending),
  });
  const sum = (list: BusinessRow[]): BusinessSum => ({
    billed: r2(list.reduce((s, r) => s + r.billed, 0)),
    cash: r2(list.reduce((s, r) => s + r.cash, 0)),
    upi: r2(list.reduce((s, r) => s + r.upi, 0)),
    oldCash: r2(list.reduce((s, r) => s + r.oldCash, 0)),
    oldUpi: r2(list.reduce((s, r) => s + r.oldUpi, 0)),
    issued: r2(list.reduce((s, r) => s + r.issued, 0)),
    pending: r2(list.reduce((s, r) => s + r.pending, 0)),
  });
  const gaming = pick("table").map(clean);
  const canteen = pick("canteen").map(clean);
  return { gaming, canteen, gamingTotal: sum(gaming), canteenTotal: sum(canteen), other: { cash: r2(other.cash), upi: r2(other.upi) } };
}

export interface DayReportItem {
  name: string;
  price: number;
  qty: number;
  revenue: number;
  // Stock right now, not at the end of that day — stock isn't recorded per day.
  left: number | null;
  profit: number | null;
}

export interface DayReportCategory {
  name: string;
  sale: number;
  soldQty: number;
  purchase: number;
  // Cash / account / credit still owed for this category, from that day's
  // BILLS (a credit paid off later already counted back on its own day).
  cash: number;
  upi: number;
  credit: number;
  // Orders placed that day that have no bill yet.
  notBilled: number;
  // Orders placed that day whose bill was made on a LATER day.
  billedLater: number;
  // Bills made that day for OLDER orders (a backlog billed in one go) or with
  // no order behind them — in that day's bills but not in that day's orders.
  oldOrdersBilled: number;
  // What the bills table says was billed for this category that day. Equals
  // sale - notBilled - billedLater + oldOrdersBilled (plus a tiny residual).
  kulBill: number;
  // What's left over once the lines above are counted: a bill whose items
  // were changed from what was ordered (edited at checkout, split another way).
  // Usually 0.
  fark: number;
  // Cash / account RECEIVED that day for this category (any day's bill).
  recvCash: number;
  recvUpi: number;
  items: DayReportItem[];
}

export interface DayReport {
  date: string;
  label: string;
  // Cash / account / credit given / settled / still owed for that day's bills.
  day: CreditHisaabDay;
  // What actually came into the galla that day.
  galla: GallaDay;
  expenses: { category: string; note: string; amount: number }[];
  settlements: { t: number; name: string; cash: number; upi: number; disc: number }[];
  // The day split by table / canteen category, ending with a "Total" row:
  // cash and account, credit given that day, how much of it has since been
  // paid off, and what's still owed.
  // "billed" = everything billed on that row: cash + account + still owed +
  // written off. "subtotal" rows add up the tables, then the canteen.
  dailyRows: {
    item: string;
    kind: "table" | "canteen" | "other" | "subtotal" | "total";
    billed: number;
    cash: number;
    upi: number;
    issued: number;
    settled: number;
    credit: number;
  }[];
  // Cash and account RECEIVED that day by the table / category it was paid
  // for, ending with a "Total" that equals the galla — what staff count in the
  // drawer.
  receivedRows: { item: string; kind: "table" | "canteen" | "other" | "total"; cash: number; upi: number }[];
  canteen: DayReportCategory[];
  // The same day split into the two businesses, Cash and Account each on their own.
  business: BusinessDay;
  // Canteen sale on order lines whose menu item has since been deleted.
  orphanSale: number;
  ordersCount: number;
}

// One day's whole picture — the same screen the PDF is made from, so the app
// and the PDF can't differ. Everything comes from the shared functions in
// billing.ts (creditHisaab, gallaByDate, dailyCollectionRows,
// categoryStockProfit), the same ones the Excel exports use.
export function buildDayReport(input: {
  date: string;
  bills: Bill[];
  orders: CanteenOrder[];
  expenses: Expense[];
  menuItems: MenuItem[];
  menuCategories: MenuCategory[];
  tables: { name: string }[];
  customers: Customer[];
}): DayReport {
  const { date, orders, expenses, menuItems, menuCategories, tables, customers } = input;
  const round = (n: number) => Math.round(n * 100) / 100;
  const live = input.bills.filter((b) => b.status !== "cancelled");
  const dayStart = dateInputValueToIstMidnight(date);
  const dayEnd = dayStart + 86_400_000;
  const label = formatDateKey(date, { day: "numeric", month: "long" });

  const galla: GallaDay = gallaByDate(live).get(date) ?? {
    freshCash: 0,
    freshUpi: 0,
    settledCash: 0,
    settledUpi: 0,
    forgiven: 0,
    settledCount: 0,
    creditGiven: 0,
  };

  // A day with no billing and no payments at all still gets a (zero) entry.
  const day: CreditHisaabDay = creditHisaab(live, menuItems, menuCategories, tables, customers, dayStart, dayEnd).days.find(
    (d) => d.dateKey === date
  ) ?? {
    dateKey: date,
    label,
    cash: 0,
    upi: 0,
    issued: 0,
    settled: 0,
    pending: 0,
    untracedCash: 0,
    untracedUpi: 0,
    people: [],
    gallaCash: round(galla.freshCash + galla.settledCash),
    gallaUpi: round(galla.freshUpi + galla.settledUpi),
    movedOutCash: 0,
    movedOutUpi: 0,
    movedInCash: 0,
    movedInUpi: 0,
    items: [],
    billed: 0,
    received: [],
  };

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const settlements = live
    .filter((b) => b.status === "paid" && isCreditSettlement(b) && toDateInputValue(b.createdAt) === date)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((b) => ({
      t: b.createdAt,
      name: settlementPersonName(b, b.customerId ? customerById.get(b.customerId) : undefined),
      cash: b.amountCash,
      upi: b.amountUpi,
      disc: b.discount,
    }));

  type Row = DayReport["dailyRows"][number];
  const itemRows: Row[] = day.items.map((x) => ({
    item: x.item,
    kind: x.kind,
    billed: x.billed,
    cash: x.cash,
    upi: x.upi,
    issued: x.issued,
    settled: round(x.issued - x.pending),
    credit: x.pending,
  }));
  const subtotal = (name: string, rows: Row[]): Row => ({
    item: name,
    kind: "subtotal",
    billed: round(rows.reduce((t, r) => t + r.billed, 0)),
    cash: round(rows.reduce((t, r) => t + r.cash, 0)),
    upi: round(rows.reduce((t, r) => t + r.upi, 0)),
    issued: round(rows.reduce((t, r) => t + r.issued, 0)),
    settled: round(rows.reduce((t, r) => t + r.settled, 0)),
    credit: round(rows.reduce((t, r) => t + r.credit, 0)),
  });
  const tableRows = itemRows.filter((r) => r.kind === "table");
  const canteenRows = itemRows.filter((r) => r.kind === "canteen");
  const otherRows = itemRows.filter((r) => r.kind === "other");
  // The Total row is the day's own figures (the same ones the tiles above show),
  // not a re-addition of the rounded rows, so the two can never differ by a paisa.
  const dailyRows: Row[] =
    itemRows.length === 0
      ? []
      : [
          ...tableRows,
          ...(tableRows.length ? [subtotal("Table ka total", tableRows)] : []),
          ...canteenRows,
          ...(canteenRows.length ? [subtotal("Canteen ka total", canteenRows)] : []),
          ...otherRows,
          {
            item: "Total",
            kind: "total",
            billed: day.billed,
            cash: day.cash,
            upi: day.upi,
            issued: day.issued,
            settled: day.settled,
            credit: day.pending,
          },
        ];

  const receivedRows: DayReport["receivedRows"] =
    day.received.length === 0
      ? []
      : [
          ...day.received.map((r) => ({ item: r.item, kind: r.kind, cash: r.cash, upi: r.upi })),
          // the galla's own figures, so this total can never differ by a paisa
          { item: "Total", kind: "total" as const, cash: round(galla.freshCash + galla.settledCash), upi: round(galla.freshUpi + galla.settledUpi) },
        ];

  // Canteen: what was ordered that day, category by category, exactly as the
  // Monthly Report's category sheets count it.
  const dayOrders = orders.filter((o) => o.createdAt >= dayStart && o.createdAt < dayEnd);
  const dayExpenses = expenses.filter((e) => e.createdAt >= dayStart && e.createdAt < dayEnd);
  const cats = categoryStockProfit(dayOrders, dayExpenses, menuItems, menuCategories);
  const itemById = new Map(menuItems.map((i) => [i.id, i]));
  const categoryNameById = new Map(menuCategories.map((c) => [c.id, c.name]));
  const billByOrderId = new Map<string, Bill>();
  for (const b of live) if (b.orderId) billByOrderId.set(b.orderId, b);
  // Bills made this day for orders placed on another day (or with no order
  // behind them), by canteen category — read off the bill's own items by name.
  const categoryByItemName = new Map<string, string>();
  for (const i of menuItems) {
    const cat = categoryNameById.get(i.categoryId);
    if (cat) categoryByItemName.set(i.name.trim().toLowerCase(), cat);
  }
  const orderCreatedById = new Map(orders.map((o) => [o.id, o.createdAt]));
  const oldBilledByCategory = new Map<string, number>();
  for (const b of live) {
    if (toDateInputValue(b.createdAt) !== date || isCreditSettlement(b)) continue;
    if (b.status !== "paid" && !b.shares) continue;
    const orderedAt = b.orderId ? orderCreatedById.get(b.orderId) : undefined;
    if (orderedAt != null && toDateInputValue(orderedAt) === date) continue;
    for (const item of b.canteenItems) {
      const cat = categoryByItemName.get(item.name.trim().toLowerCase());
      if (cat) oldBilledByCategory.set(cat, (oldBilledByCategory.get(cat) ?? 0) + item.price * item.qty);
    }
  }

  const canteen: DayReportCategory[] = cats.map((c) => {
    const items: DayReportItem[] = c.itemRows
      .map((r) => ({
        name: r.name.trim(),
        price: r.price,
        qty: r.qtySold,
        revenue: round(r.revenue),
        left: r.remainingQty,
        profit: r.marginPerUnit == null ? null : round(r.marginPerUnit * r.qtySold),
      }))
      .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name));
    const rowLabel = REPORT_CATEGORIES.find((rc) => rc.categoryName === c.categoryName)?.sheet.replace(" collection", "");
    const pay = dailyRows.find((r) => r.item === rowLabel);
    let notBilled = 0;
    let billedLater = 0;
    for (const o of dayOrders) {
      // "Billed" means a bill actually exists for the order — not the order's
      // own status flag, which can still say "served" after its bill was made
      // (the same test the Credits page uses for what's still unbilled).
      const bill = billByOrderId.get(o.id);
      const laterBilled = !!bill && toDateInputValue(bill.createdAt) !== date;
      for (const l of o.items) {
        const it = itemById.get(l.menuItemId);
        if (!it || categoryNameById.get(it.categoryId) !== c.categoryName) continue;
        if (!bill) notBilled += l.qty * l.price;
        else if (laterBilled) billedLater += l.qty * l.price;
      }
    }
    const oldOrdersBilled = oldBilledByCategory.get(c.categoryName) ?? 0;
    const recv = day.received.find((r) => r.item === rowLabel);
    return {
      name: c.categoryName,
      sale: round(c.sale),
      soldQty: items.reduce((s, i) => s + i.qty, 0),
      purchase: round(c.purchase),
      cash: pay ? Number(pay.cash) : 0,
      upi: pay ? Number(pay.upi) : 0,
      credit: pay ? Number(pay.credit) : 0,
      notBilled: round(notBilled),
      billedLater: round(billedLater),
      oldOrdersBilled: round(oldOrdersBilled),
      kulBill: pay ? pay.billed : 0,
      fark: round((pay ? pay.billed : 0) - (round(c.sale) - notBilled - billedLater + oldOrdersBilled)),
      recvCash: recv ? recv.cash : 0,
      recvUpi: recv ? recv.upi : 0,
      items,
    };
  });

  let orphanSale = 0;
  for (const o of dayOrders) for (const l of o.items) if (!itemById.has(l.menuItemId)) orphanSale += l.qty * l.price;

  return {
    date,
    label,
    day,
    galla,
    expenses: expenses
      .filter((e) => toDateInputValue(e.createdAt) === date)
      .map((e) => ({ category: e.category, note: e.note, amount: e.amount })),
    settlements,
    dailyRows,
    receivedRows,
    canteen,
    business: businessOfDay(day),
    orphanSale: round(orphanSale),
    ordersCount: dayOrders.length,
  };
}

export interface SheetSpec {
  name: string;
  rows: Record<string, string | number>[];
  widths: number[];
}

// The day report as Excel sheets — the same sections, in the same order, as
// the PDF and the in-app screen: the day's hisaab and galla, table and canteen
// split, who took credit, who paid it off, then one sheet per canteen
// category with every item. Used by the app's "Excel" button and by the PDF
// tool in tools/credit-report, so the two files can't differ.
export function dayReportSheets(r: DayReport): SheetSpec[] {
  const round = (n: number) => Math.round(n * 100) / 100;
  const sum = (rows: Record<string, string | number>[], key: string) =>
    round(rows.reduce((s, row) => s + (Number(row[key]) || 0), 0));
  const g = r.galla;
  const d = r.day;
  const spent = r.expenses.reduce((s, e) => s + e.amount, 0);
  const galla = round(g.freshCash + g.freshUpi + g.settledCash + g.settledUpi);

  const biz = r.business;
  const gt = biz.gamingTotal;
  const ct = biz.canteenTotal;
  const blank = { Cheez: "", Cash: "", Account: "", Rakam: "" };
  const sheets: SheetSpec[] = [];

  // Gaming and Canteen each on their own: what was billed, Cash and Account that
  // came in (kept apart), and the credit given.
  const bizBlock = (title: string, t: typeof gt) => [
    { ...blank, Cheez: title },
    { ...blank, Cheez: "Kul bill (us din)", Rakam: t.billed },
    { Cheez: "Paisa aaya (galla mein)", Cash: t.cash, Account: t.upi, Rakam: round(t.cash + t.upi) },
    { Cheez: "   isme purane credit ka paisa", Cash: t.oldCash, Account: t.oldUpi, Rakam: round(t.oldCash + t.oldUpi) },
    { ...blank, Cheez: "Credit diya (udhaar)", Rakam: t.issued },
    { ...blank },
  ];
  const other = biz.other;
  sheets.push({
    name: "Din ka hisaab",
    widths: [70, 14, 14, 14],
    rows: [
      ...bizBlock("1) GAMING", gt),
      ...bizBlock("2) CANTEEN", ct),
      { ...blank, Cheez: "3) KUL GALLA - Gaming + Canteen" },
      { Cheez: "Gaming", Cash: gt.cash, Account: gt.upi, Rakam: round(gt.cash + gt.upi) },
      { Cheez: "Canteen", Cash: ct.cash, Account: ct.upi, Rakam: round(ct.cash + ct.upi) },
      ...(Math.abs(other.cash) + Math.abs(other.upi) > 0.005
        ? [{ Cheez: "Purana credit / advance (kisi table ya category se match nahi)", Cash: other.cash, Account: other.upi, Rakam: round(other.cash + other.upi) }]
        : []),
      { Cheez: "TOTAL galla", Cash: round(g.freshCash + g.settledCash), Account: round(g.freshUpi + g.settledUpi), Rakam: galla },
      { ...blank, Cheez: "Kharcha (expenses)", Rakam: -spent },
      { ...blank, Cheez: "Kharcha ke baad bacha", Rakam: round(galla - spent) },
    ],
  });

  const bizSheet = (name: string, firstCol: string, rows: typeof biz.gaming, t: typeof gt): SheetSpec => ({
    name,
    widths: [30, 12, 14, 14, 22, 14],
    rows: [
      ...rows.map((x) => ({
        [firstCol]: x.item,
        "Kul bill": x.billed,
        "Cash aaya": x.cash,
        "Account aaya": x.upi,
        "Isme purane credit ka": round(x.oldCash + x.oldUpi),
        "Credit diya": x.issued,
      })),
      {
        [firstCol]: "TOTAL",
        "Kul bill": t.billed,
        "Cash aaya": t.cash,
        "Account aaya": t.upi,
        "Isme purane credit ka": round(t.oldCash + t.oldUpi),
        "Credit diya": t.issued,
      },
    ],
  });
  sheets.push(bizSheet("Gaming (table-wise)", "Table", biz.gaming, gt));
  sheets.push(bizSheet("Canteen (category-wise)", "Category", biz.canteen, ct));

  sheets.push({
    name: "Credit (Gaming-Canteen)",
    widths: [50, 14, 14, 14],
    rows: [
      { Cheez: "Naya credit diya", Gaming: gt.issued, Canteen: ct.issued, Kul: d.issued },
      { Cheez: "Isme se ab tak chuka (Cash + Account + maaf)", Gaming: round(gt.issued - gt.pending), Canteen: round(ct.issued - ct.pending), Kul: d.settled },
      { Cheez: "CREDIT BAAKI (diya - chuka)", Gaming: gt.pending, Canteen: ct.pending, Kul: d.pending },
    ],
  });

  const people = d.people.map((p) => ({
    Naam: p.name,
    "Credit liya": p.issued,
    "Isme se chuka": p.settled,
    "Abhi baaki": p.pending,
  }));
  people.push({
    Naam: "TOTAL",
    "Credit liya": sum(people, "Credit liya"),
    "Isme se chuka": sum(people, "Isme se chuka"),
    "Abhi baaki": sum(people, "Abhi baaki"),
  });
  sheets.push({ name: "Credit (us din ka)", widths: [34, 14, 16, 14], rows: people });

  const settle = r.settlements.map((s) => ({
    Time: formatTime(s.t),
    Naam: s.name,
    Cash: round(s.cash),
    Account: round(s.upi),
    "Maaf (discount)": round(s.disc),
    "Cash + Account": round(s.cash + s.upi),
  }));
  settle.push({
    Time: "TOTAL",
    Naam: "",
    Cash: sum(settle, "Cash"),
    Account: sum(settle, "Account"),
    "Maaf (discount)": sum(settle, "Maaf (discount)"),
    "Cash + Account": sum(settle, "Cash + Account"),
  });
  sheets.push({ name: "Purana credit settle", widths: [10, 30, 10, 10, 16, 14], rows: settle });

  const cat = r.canteen.map((c) => ({
    Category: c.name,
    "Kitna bika (qty)": c.soldQty,
    "Bika (Rs)": c.sale,
    "- Abhi bill nahi hua": c.notBilled,
    "- Baad mein bill hua": c.billedLater,
    "+ Purane orders ka bill aaj bana": c.oldOrdersBilled,
    "+ Baaki fark (bill ke items order se alag)": c.fark,
    "= Kul bill (bills ke hisaab se)": c.kulBill,
    "Cash aaya": c.recvCash,
    "Account aaya": c.recvUpi,
  }));
  const catTotal: Record<string, string | number> = { Category: "TOTAL" };
  for (const k of Object.keys(cat[0] ?? {})) if (k !== "Category") catTotal[k] = sum(cat, k);
  if (cat.length) cat.push(catTotal as (typeof cat)[number]);
  sheets.push({ name: "Canteen ek nazar", widths: [16, 16, 12, 20, 20, 30, 36, 28, 12, 14], rows: cat });

  for (const c of r.canteen) {
    const rows: Record<string, string | number>[] = c.items.map((it) => ({
      Item: it.name,
      Rate: it.price,
      "Kitna bika": it.qty,
      "Bika (Rs)": it.revenue,
      "Abhi stock mein": it.left == null ? "Not tracked" : it.left,
      Profit: it.profit == null || !it.qty ? "-" : it.profit,
    }));
    rows.push({
      Item: "TOTAL",
      Rate: "",
      "Kitna bika": sum(rows, "Kitna bika"),
      "Bika (Rs)": sum(rows, "Bika (Rs)"),
      "Abhi stock mein": "",
      Profit: sum(rows, "Profit"),
    });
    sheets.push({ name: c.name, widths: [34, 10, 12, 12, 16, 12], rows });
  }
  sheets.push({
    name: "Milaan (accountant)",
    widths: [72, 14, 14],
    rows: [
      { Cheez: "Galla - us din asal mein aaya", Cash: round(d.gallaCash), Account: round(d.gallaUpi) },
      { Cheez: "- Us din aaya, par dusre din ke credit ka tha (wahan gina gaya)", Cash: -d.movedOutCash, Account: -d.movedOutUpi },
      { Cheez: "+ Dusre din aaya, par is din ke credit ka tha", Cash: d.movedInCash, Account: d.movedInUpi },
      { Cheez: "= Us din ke bills ka hisaab", Cash: d.cash, Account: d.upi },
    ],
  });
  return sheets;
}
