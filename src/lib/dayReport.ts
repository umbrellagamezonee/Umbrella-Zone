import type { Bill, CanteenOrder, Customer, Expense, MenuCategory, MenuItem } from "../types";
import {
  REPORT_CATEGORIES,
  categoryStockProfit,
  creditHisaab,
  dailyCollectionRows,
  gallaByDate,
  type CreditHisaabDay,
  type GallaDay,
} from "./billing";
import { isCreditSettlement, settlementPersonName } from "./billLabel";
import { dateInputValueToIstMidnight, formatDateKey, formatTime, toDateInputValue } from "./format";

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
  dailyRows: { item: string; total: number | string; cash: number | string; upi: number | string; credit: number | string }[];
  canteen: DayReportCategory[];
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
  };

  const galla: GallaDay = gallaByDate(live).get(date) ?? {
    freshCash: 0,
    freshUpi: 0,
    settledCash: 0,
    settledUpi: 0,
    forgiven: 0,
    settledCount: 0,
    creditGiven: 0,
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

  const dailyRows = dailyCollectionRows(live, menuItems, menuCategories, tables, customers, dayStart, dayEnd)
    .filter((r) => r.Date === label && r.Item !== "")
    .map((r) => ({ item: r.Item, total: r["Total collection"], cash: r.Cash, upi: r.Account, credit: r.Credit }));

  // Canteen: what was ordered that day, category by category, exactly as the
  // Monthly Report's category sheets count it.
  const dayOrders = orders.filter((o) => o.createdAt >= dayStart && o.createdAt < dayEnd);
  const dayExpenses = expenses.filter((e) => e.createdAt >= dayStart && e.createdAt < dayEnd);
  const cats = categoryStockProfit(dayOrders, dayExpenses, menuItems, menuCategories);
  const itemById = new Map(menuItems.map((i) => [i.id, i]));
  const categoryNameById = new Map(menuCategories.map((c) => [c.id, c.name]));

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
    for (const o of dayOrders) {
      if (o.status === "billed") continue;
      for (const l of o.items) {
        const it = itemById.get(l.menuItemId);
        if (it && categoryNameById.get(it.categoryId) === c.categoryName) notBilled += l.qty * l.price;
      }
    }
    return {
      name: c.categoryName,
      sale: round(c.sale),
      soldQty: items.reduce((s, i) => s + i.qty, 0),
      purchase: round(c.purchase),
      cash: pay ? Number(pay.cash) : 0,
      upi: pay ? Number(pay.upi) : 0,
      credit: pay ? Number(pay.credit) : 0,
      notBilled: round(notBilled),
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
    canteen,
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

  const blank = { Cheez: "", Cash: "", Account: "", Rakam: "" };
  const sheets: SheetSpec[] = [];

  sheets.push({
    name: "Din ka hisaab",
    widths: [70, 14, 14, 14],
    rows: [
      { ...blank, Cheez: "1) US DIN KE BILLS KA HISAAB (baad mein chuka credit usi din mein gina gaya)" },
      { Cheez: "Cash / Account", Cash: d.cash, Account: d.upi, Rakam: round(d.cash + d.upi) },
      { ...blank, Cheez: "Credit diya", Rakam: d.issued },
      { ...blank, Cheez: "Isme se settle hua (Cash + Account + maaf)", Rakam: d.settled },
      { ...blank, Cheez: "CREDIT BAAKI (diya - settle)", Rakam: d.pending },
      { ...blank },
      { ...blank, Cheez: "2) GALLA - US DIN ASAL MEIN JO PAISA AAYA" },
      { Cheez: "Din ke naye bills", Cash: g.freshCash, Account: g.freshUpi, Rakam: round(g.freshCash + g.freshUpi) },
      {
        Cheez: `Purana credit settle (${g.settledCount} logon ne)`,
        Cash: g.settledCash,
        Account: g.settledUpi,
        Rakam: round(g.settledCash + g.settledUpi),
      },
      { Cheez: "TOTAL galla", Cash: round(g.freshCash + g.settledCash), Account: round(g.freshUpi + g.settledUpi), Rakam: galla },
      { ...blank, Cheez: "Kharcha (expenses)", Rakam: -spent },
      { ...blank, Cheez: "Kharcha ke baad bacha", Rakam: round(galla - spent) },
      { ...blank },
      { ...blank, Cheez: "Us din naya credit diya gaya", Rakam: g.creditGiven },
    ],
  });

  sheets.push({
    name: "Table aur Canteen",
    widths: [44, 12, 12, 16, 14],
    rows: r.dailyRows.map((row) => {
      const cash = Number(row.cash) || 0;
      const upi = Number(row.upi) || 0;
      return {
        Item:
          row.item === "Total"
            ? "TOTAL"
            : row.item === "Credit settlement"
              ? "Purane credit / advance (kisi din se match nahi)"
              : row.item,
        Cash: cash,
        Account: upi,
        "Cash + Account": round(cash + upi),
        "Credit baaki": Number(row.credit) || 0,
      };
    }),
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
    "Abhi bill nahi hua": c.notBilled,
    "Bill mein Cash": c.cash,
    "Bill mein Account": c.upi,
    "Bill mein Credit baaki": c.credit,
  }));
  cat.push({
    Category: "TOTAL",
    "Kitna bika (qty)": sum(cat, "Kitna bika (qty)"),
    "Bika (Rs)": sum(cat, "Bika (Rs)"),
    "Abhi bill nahi hua": sum(cat, "Abhi bill nahi hua"),
    "Bill mein Cash": sum(cat, "Bill mein Cash"),
    "Bill mein Account": sum(cat, "Bill mein Account"),
    "Bill mein Credit baaki": sum(cat, "Bill mein Credit baaki"),
  });
  sheets.push({ name: "Canteen ek nazar", widths: [16, 16, 12, 18, 14, 16, 22], rows: cat });

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
  return sheets;
}
