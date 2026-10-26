import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Printer, X } from "lucide-react";
import { useBillsStore } from "../store/useBillsStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { useExpensesStore } from "../store/useExpensesStore";
import { useMenuStore } from "../store/useMenuStore";
import { useTablesStore, orderedTables } from "../store/useTablesStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { creditHisaab, creditHisaabSheetRows, creditPendingReport, creditPendingSheetRows } from "../lib/billing";
import { buildDayReport, businessOfDay, dayReportSheets, type BusinessSum, type SheetSpec } from "../lib/dayReport";
import { creditMonthKeys, monthlyCreditByCustomer } from "../lib/ledger";
import { dateInputValueToIstMidnight, formatDateKey, formatDateTime, formatMoney, formatTime, toDateInputValue } from "../lib/format";

// The same report the PDF is made from, inside the app: pick a day and see
// that day's cash / account / credit, who took credit and who paid it off,
// and every canteen item category by category — or switch to the whole-shop
// view of who still owes. Every number comes from lib/billing.ts and
// lib/dayReport.ts (the functions the Excel exports and the PDF use), never
// from a calculation of its own, so it can't disagree with them.
// "Excel" downloads the same sections as sheets (dayReportSheets). "PDF / Print" prints only this screen (see the .hisaab-overlay rules in
// index.css) — on a phone, choose "Save as PDF" in the print dialog.

const fmt = (n: number) => {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
};
const dash = (n: number | null | undefined) => (n == null || Math.abs(n) < 0.005 ? "-" : fmt(n));

type Tone = "plain" | "good" | "warn" | "bad";
const toneClass: Record<Tone, string> = {
  plain: "text-[var(--color-text)]",
  good: "text-[var(--color-success)]",
  warn: "text-[var(--color-warning)]",
  bad: "text-[var(--color-danger)]",
};

function Section({ title, children, breakBefore }: { title: string; children: ReactNode; breakBefore?: boolean }) {
  return (
    <section className={breakBefore ? "print:break-before-page" : undefined}>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Tiles({ items }: { items: { label: string; value: string; tone?: Tone; strong?: boolean }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {items.map((t) => (
        <div
          key={t.label}
          className={
            "rounded-xl border p-3 text-center " +
            (t.strong
              ? "border-[var(--color-danger)] bg-[var(--color-danger)]/10"
              : "border-[var(--color-border)] bg-[var(--color-surface)]")
          }
        >
          <p className="text-[11px] text-[var(--color-text-dim)]">{t.label}</p>
          <p className={"text-base font-bold mt-0.5 " + toneClass[t.tone ?? "plain"]}>{t.value}</p>
        </div>
      ))}
    </div>
  );
}

type Row = { cells: ReactNode[]; bold?: boolean; dim?: boolean };
function Table({ cols, rows }: { cols: string[]; rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-[var(--color-surface-2)] text-[var(--color-text-dim)]">
            {cols.map((c, i) => (
              <th key={c + i} className={"px-2 py-1.5 font-semibold " + (i === 0 ? "text-left" : "text-right")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr
              key={ri}
              className={
                "border-t border-[var(--color-border)] " +
                (r.bold ? "font-bold bg-[var(--color-surface-2)] " : "") +
                (r.dim ? "text-[var(--color-text-faint)]" : "")
              }
            >
              {r.cells.map((c, i) => (
                <td key={i} className={"px-2 py-1.5 " + (i === 0 ? "text-left" : "text-right whitespace-nowrap")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-[var(--color-text-faint)]">{children}</p>;
}

export function HisaabReport({
  initialDate,
  initialTab = "day",
  onClose,
}: {
  initialDate: string;
  initialTab?: "day" | "month" | "credit" | "customer";
  onClose: () => void;
}) {
  const bills = useBillsStore((s) => s.bills);
  const orders = useOrdersStore((s) => s.orders);
  const expenses = useExpensesStore((s) => s.expenses);
  const menuItems = useMenuStore((s) => s.items);
  const menuCategories = useMenuStore((s) => s.categories);
  const tables = useTablesStore((s) => s.tables);
  const customers = useCustomersStore((s) => s.customers);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const storeName = useSettingsStore((s) => s.storeName);
  const money = (n: number) => formatMoney(n, currency);

  const [tab, setTab] = useState<"day" | "month" | "credit" | "customer">(initialTab);
  const [monthSel, setMonth] = useState("");
  const [custMonth, setCustMonth] = useState("");
  const [custSearch, setCustSearch] = useState("");
  const [date, setDate] = useState(initialDate);
  const [openedAt] = useState(() => Date.now());
  const [working, setWorking] = useState(false);
  const orderedTablesList = useMemo(() => orderedTables(tables), [tables]);

  const day = useMemo(
    () =>
      buildDayReport({
        date,
        bills,
        orders,
        expenses,
        menuItems,
        menuCategories,
        tables: orderedTablesList,
        customers,
      }),
    [date, bills, orders, expenses, menuItems, menuCategories, orderedTablesList, customers]
  );

  const live = useMemo(() => bills.filter((b) => b.status !== "cancelled"), [bills]);
  const credit = useMemo(
    () => (tab === "credit" ? creditHisaab(live, menuItems, menuCategories, orderedTablesList, customers) : null),
    [tab, live, menuItems, menuCategories, orderedTablesList, customers]
  );
  const pending = useMemo(
    () => (tab === "credit" ? creditPendingReport(bills, customers, orders) : null),
    [tab, bills, customers, orders]
  );

  // The month, Gaming and Canteen each on their own — day by day and in total.
  const allMonthKeys = useMemo(() => (tab === "month" ? creditMonthKeys(bills, orders) : []), [tab, bills, orders]);
  const monthKey = monthSel || allMonthKeys[0] || "";
  const monthLabel = monthKey ? formatDateKey(`${monthKey}-01`, { month: "long", year: "numeric" }) : "";
  const month = useMemo(() => {
    if (tab !== "month" || !monthKey) return null;
    const h = creditHisaab(live, menuItems, menuCategories, orderedTablesList, customers);
    const spentByDay = new Map<string, number>();
    for (const e of expenses) {
      const k = toDateInputValue(e.createdAt);
      spentByDay.set(k, (spentByDay.get(k) ?? 0) + e.amount);
    }
    const zero = (): BusinessSum => ({ billed: 0, cash: 0, upi: 0, oldCash: 0, oldUpi: 0, issued: 0, pending: 0 });
    const add = (t: BusinessSum, x: BusinessSum) => {
      for (const k of Object.keys(t) as (keyof BusinessSum)[]) t[k] += x[k];
    };
    type MonthRow = {
      dateKey: string;
      label: string;
      gaming: BusinessSum;
      canteen: BusinessSum;
      other: { cash: number; upi: number };
      gallaCash: number;
      gallaUpi: number;
      spent: number;
    };
    const days: MonthRow[] = [];
    const seen = new Set<string>();
    for (const d of h.days) {
      if (!d.dateKey.startsWith(monthKey)) continue;
      const b = businessOfDay(d);
      seen.add(d.dateKey);
      days.push({
        dateKey: d.dateKey,
        label: d.label,
        gaming: b.gamingTotal,
        canteen: b.canteenTotal,
        other: b.other,
        gallaCash: d.gallaCash,
        gallaUpi: d.gallaUpi,
        spent: spentByDay.get(d.dateKey) ?? 0,
      });
    }
    // a day with only a kharcha entry (nothing billed) still belongs in the month
    for (const [k, v] of spentByDay) {
      if (k.startsWith(monthKey) && !seen.has(k)) {
        days.push({
          dateKey: k,
          label: formatDateKey(k, { day: "numeric", month: "long" }),
          gaming: zero(),
          canteen: zero(),
          other: { cash: 0, upi: 0 },
          gallaCash: 0,
          gallaUpi: 0,
          spent: v,
        });
      }
    }
    days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const total = { gaming: zero(), canteen: zero(), other: { cash: 0, upi: 0 }, gallaCash: 0, gallaUpi: 0, spent: 0 };
    for (const r of days) {
      add(total.gaming, r.gaming);
      add(total.canteen, r.canteen);
      total.other.cash += r.other.cash;
      total.other.upi += r.other.upi;
      total.gallaCash += r.gallaCash;
      total.gallaUpi += r.gallaUpi;
      total.spent += r.spent;
    }
    return { days, ...total };
  }, [tab, monthKey, live, menuItems, menuCategories, orderedTablesList, customers, expenses]);

  // Customer-wise credit for one month — the same ledger each customer's own
  // profile shows, so a month's figures here match theirs exactly.
  const monthKeys = useMemo(() => (tab === "customer" ? creditMonthKeys(bills, orders) : []), [tab, bills, orders]);
  const custMonthKey = custMonth || monthKeys[0] || "";
  const custRows = useMemo(
    () => (tab === "customer" && custMonthKey ? monthlyCreditByCustomer(bills, orders, customers, custMonthKey) : []),
    [tab, bills, orders, customers, custMonthKey]
  );
  const custShown = custRows.filter((r) => r.name.toLowerCase().includes(custSearch.trim().toLowerCase()));
  const custMonthLabel = custMonthKey ? formatDateKey(`${custMonthKey}-01`, { month: "long", year: "numeric" }) : "";

  // Loaded on demand, like the other Excel exports — the library is only
  // needed the moment someone taps the button.
  async function downloadExcel() {
    setWorking(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const add = (sheet: SheetSpec) => {
        const ws = XLSX.utils.json_to_sheet(sheet.rows);
        ws["!cols"] = sheet.widths.map((wch) => ({ wch }));
        XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
      };
      if (tab === "day") {
        dayReportSheets(day).forEach(add);
        XLSX.writeFile(wb, `Din-Hisaab-${date}.xlsx`);
      } else if (tab === "month" && month) {
        const r2 = (n: number) => Math.round(n * 100) / 100;
        const rows: Record<string, string | number>[] = month.days.map((r) => ({
          Din: r.label,
          "Gaming Cash": r2(r.gaming.cash),
          "Gaming Account": r2(r.gaming.upi),
          "Gaming Credit diya": r2(r.gaming.issued),
          "Canteen Cash": r2(r.canteen.cash),
          "Canteen Account": r2(r.canteen.upi),
          "Canteen Credit diya": r2(r.canteen.issued),
          "Kul galla (Cash + Account)": r2(r.gallaCash + r.gallaUpi),
          Kharcha: r2(r.spent),
        }));
        rows.push({
          Din: "TOTAL",
          "Gaming Cash": r2(month.gaming.cash),
          "Gaming Account": r2(month.gaming.upi),
          "Gaming Credit diya": r2(month.gaming.issued),
          "Canteen Cash": r2(month.canteen.cash),
          "Canteen Account": r2(month.canteen.upi),
          "Canteen Credit diya": r2(month.canteen.issued),
          "Kul galla (Cash + Account)": r2(month.gallaCash + month.gallaUpi),
          Kharcha: r2(month.spent),
        });
        add({ name: `Mahina ${monthLabel}`, rows, widths: [16, 13, 15, 17, 13, 15, 18, 22, 11] });
        XLSX.writeFile(wb, `Mahine-Ka-Hisaab-${monthKey}.xlsx`);
      } else if (tab === "customer") {
        const rows = custShown.map((r) => ({
          Naam: r.name,
          "Shuru mein baaki": r.opening,
          "Credit liya (is mahine)": r.added,
          "Isme Gaming": r.addedGaming,
          "Isme Canteen": r.addedCanteen,
          "Chukaya (is mahine)": r.paid,
          "End mein baaki": r.closing,
        }));
        const sum = (k: string) => Math.round(rows.reduce((t, x) => t + ((x as Record<string, number | string>)[k] as number), 0) * 100) / 100;
        rows.push({
          Naam: "TOTAL",
          "Shuru mein baaki": sum("Shuru mein baaki"),
          "Credit liya (is mahine)": sum("Credit liya (is mahine)"),
          "Isme Gaming": sum("Isme Gaming"),
          "Isme Canteen": sum("Isme Canteen"),
          "Chukaya (is mahine)": sum("Chukaya (is mahine)"),
          "End mein baaki": sum("End mein baaki"),
        });
        add({ name: `Customer-wise ${custMonthLabel}`, rows, widths: [32, 18, 22, 14, 14, 20, 16] });
        XLSX.writeFile(wb, `Customer-Credit-${custMonthKey}.xlsx`);
      } else if (credit && pending) {
        add({ name: "Credit hisaab", rows: creditHisaabSheetRows(credit), widths: [44, 16, 16, 13, 17, 13, 18, 18] });
        add({ name: "Credit baaki - kiska", rows: creditPendingSheetRows(pending), widths: [56, 26, 20, 14] });
        XLSX.writeFile(wb, `Credit-Hisaab-${toDateInputValue(openedAt)}.xlsx`);
      }
    } finally {
      setWorking(false);
    }
  }

  function shiftDay(delta: number) {
    setDate(toDateInputValue(dateInputValueToIstMidnight(date) + delta * 86_400_000 + 12 * 3_600_000));
  }

  const g = day.galla;
  const galla = {
    cash: g.freshCash + g.settledCash,
    upi: g.freshUpi + g.settledUpi,
  };
  const spent = day.expenses.reduce((s, e) => s + e.amount, 0);
  const dateLabel = formatDateKey(date, { day: "numeric", month: "long", year: "numeric" });

  const d = day.day;
  const showFark = day.canteen.some((c) => Math.abs(c.fark) > 0.5);
  const biz = day.business;
  const gt = biz.gamingTotal;
  const ct = biz.canteenTotal;
  const ot = biz.other;
  const gallaTotal = galla.cash + galla.upi;
  // One business on its own: what was billed, Cash and Account that came in for it
  // (kept apart), and the credit given. The table underneath is row by row.
  const businessSection = (title: string, firstCol: string, rows: typeof biz.gaming, t: typeof gt, emptyText: string) => (
    <Section title={title}>
      <Tiles
        items={[
          { label: "Kul bill", value: money(t.billed) },
          { label: "Cash aaya", value: money(t.cash), tone: "good" },
          { label: "Account aaya", value: money(t.upi), tone: "good" },
          { label: "Credit diya (udhaar)", value: money(t.issued), tone: "warn" },
        ]}
      />
      {rows.length === 0 ? (
        <Note>{emptyText}</Note>
      ) : (
        <Table
          cols={[firstCol, "Kul bill", "Cash aaya", "Account aaya", "Credit diya"]}
          rows={[
            ...rows.map((r) => ({ cells: [r.item, dash(r.billed), dash(r.cash), dash(r.upi), dash(r.issued)] })),
            { bold: true, cells: ["TOTAL", fmt(t.billed), fmt(t.cash), fmt(t.upi), fmt(t.issued)] },
          ]}
        />
      )}
      <Note>
        Cash aaya / Account aaya = us din jo paisa is business ke liye gulle mein aaya.
        {t.oldCash + t.oldUpi > 0.005
          ? ` Isme purane credit ka paisa bhi hai: Cash ${money(t.oldCash)}, Account ${money(t.oldUpi)}.`
          : ""}{" "}
        Credit diya = jo us din udhaar gaya (abhi baaki: {money(t.pending)}).
      </Note>
    </Section>
  );
  const dayView = (
    <div className="space-y-6">
      {businessSection("1) GAMING — table ka hisaab", "Table", biz.gaming, gt, "Is din gaming ka koi bill nahi bana.")}
      {businessSection("2) CANTEEN — food, drinks, cigarette, chocolate", "Category", biz.canteen, ct, "Is din canteen ka koi bill nahi bana.")}

      <Section title="3) Kul galla — Gaming + Canteen (Cash aur Account alag)">
        <Tiles
          items={[
            { label: "Cash", value: money(galla.cash), tone: "good" },
            { label: "Account", value: money(galla.upi), tone: "good" },
            { label: "Kharcha", value: "-" + money(spent), tone: "bad" },
            { label: "Kharcha ke baad bacha", value: money(gallaTotal - spent), strong: true },
          ]}
        />
        <Table
          cols={["", "Cash", "Account", "Cash + Account"]}
          rows={[
            { cells: ["Gaming", dash(gt.cash), dash(gt.upi), dash(gt.cash + gt.upi)] },
            { cells: ["Canteen", dash(ct.cash), dash(ct.upi), dash(ct.cash + ct.upi)] },
            ...(Math.abs(ot.cash) + Math.abs(ot.upi) > 0.005
              ? [{ cells: ["Purana credit / advance (kisi table ya category se match nahi)", dash(ot.cash), dash(ot.upi), dash(ot.cash + ot.upi)] }]
              : []),
            { bold: true, cells: ["TOTAL galla", fmt(galla.cash), fmt(galla.upi), fmt(gallaTotal)] },
            {
              cells: [
                day.expenses.length
                  ? `Kharcha: ${day.expenses.map((e) => `${e.category} ${fmt(e.amount)}`).join(", ")}`
                  : "Kharcha",
                "",
                "",
                spent ? "-" + fmt(spent) : "-",
              ],
            },
            { bold: true, cells: ["Kharcha ke baad bacha", "", "", fmt(gallaTotal - spent)] },
          ]}
        />
        <Note>
          Galla = us din jo paisa gulle mein aaya, chahe wo kisi bhi din ke credit ka ho ({money(g.settledCash + g.settledUpi)} purane credit ka
          hai: Gaming {money(gt.oldCash + gt.oldUpi)}, Canteen {money(ct.oldCash + ct.oldUpi)}). Ye wahi hai jo Galla Summary mein dikhta hai.
        </Note>
      </Section>

      <Section title={`4) ${dateLabel} ka credit`}>
        <Table
          cols={["", "Gaming", "Canteen", "Kul"]}
          rows={[
            { cells: ["Naya credit diya", dash(gt.issued), dash(ct.issued), fmt(d.issued)] },
            { cells: ["Isme se ab tak chuka (Cash + Account + maaf)", dash(gt.issued - gt.pending), dash(ct.issued - ct.pending), fmt(d.settled)] },
            { bold: true, cells: ["CREDIT BAAKI", fmt(gt.pending), fmt(ct.pending), fmt(d.pending)] },
          ]}
        />
        <Note>Credit diya − chuka = baaki. Jo credit baad mein chuka (cash / account / maaf) wo usi din ke credit mein ginta hai jis din ka wo credit tha.</Note>
        {d.people.length === 0 ? (
          <Note>Is din koi naya credit nahi diya gaya.</Note>
        ) : (
          <Table
            cols={["Kisne liya", "Credit liya", "Isme se chuka", "Abhi baaki"]}
            rows={[
              ...d.people.map((p) => ({ cells: [p.name, dash(p.issued), dash(p.settled), dash(p.pending)] })),
              { bold: true, cells: ["TOTAL", fmt(d.issued), fmt(d.settled), fmt(d.pending)] },
            ]}
          />
        )}
        <p className="text-xs font-semibold pt-2">
          Is din purana credit kisne chukaya ({day.settlements.length})
        </p>
        {day.settlements.length === 0 ? (
          <Note>Is din kisi ne purana credit settle nahi kiya.</Note>
        ) : (
          <Table
            cols={["Time", "Naam", "Cash", "Account", "Maaf"]}
            rows={[
              ...day.settlements.map((s) => ({ cells: [formatTime(s.t), s.name, dash(s.cash), dash(s.upi), dash(s.disc)] })),
              { bold: true, cells: ["", "TOTAL", fmt(g.settledCash), fmt(g.settledUpi), dash(g.forgiven)] },
            ]}
          />
        )}
      </Section>

      <details className="print:hidden rounded-xl border border-[var(--color-border)] px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--color-text-dim)]">
          Accountant ke liye: galla aur us din ke bills ka milaan
        </summary>
        <div className="space-y-2 pt-2">
          <Note>
            Jo paisa baad mein credit chukane mein aaya wo us din ke bills ke hisaab mein gina jaata hai jis din ka wo credit tha — isliye us din ke
            bills ka Cash/Account galla se alag ho sakta hai. Ye milaan hai:
          </Note>
          <Table
            cols={["", "Cash", "Account"]}
            rows={[
              { cells: ["Galla — us din asal mein aaya", fmt(galla.cash), fmt(galla.upi)] },
              { cells: ["− Us din aaya, par dusre din ke credit ka tha", "-" + fmt(d.movedOutCash), "-" + fmt(d.movedOutUpi)] },
              { cells: ["+ Dusre din aaya, par is din ke credit ka tha", "+" + fmt(d.movedInCash), "+" + fmt(d.movedInUpi)] },
              { bold: true, cells: ["= Us din ke bills ka hisaab", fmt(d.cash), fmt(d.upi)] },
            ]}
          />
        </div>
      </details>

      <Section title="5) Canteen — category ke hisaab se" breakBefore>
        <Note>
          'Bika (Rs)' = us din jo orders gaye (jaise Monthly Report mein). Section 4 ka 'Kul bill' us din ke BILLS hain — order ek din ho sakta hai
          aur bill doosre din, isliye dono ko is tarah milao:
        </Note>
        <Table
          cols={[
            "Category",
            "Kitna bika",
            "Bika (Rs)",
            "− Abhi bill nahi hua",
            "− Baad mein bill hua",
            "+ Purane orders ka bill aaj bana",
            ...(showFark ? ["+ Baaki fark"] : []),
            "= Kul bill (Section 4)",
            "Cash aaya",
            "Account aaya",
          ]}
          rows={[
            ...day.canteen.map((c) => ({
              cells: [
                c.name,
                c.soldQty,
                fmt(c.sale),
                dash(c.notBilled),
                dash(c.billedLater),
                dash(c.oldOrdersBilled),
                ...(showFark ? [dash(c.fark)] : []),
                fmt(c.kulBill),
                dash(c.recvCash),
                dash(c.recvUpi),
              ],
            })),
            {
              bold: true,
              cells: [
                "TOTAL",
                day.canteen.reduce((s, c) => s + c.soldQty, 0),
                fmt(day.canteen.reduce((s, c) => s + c.sale, 0)),
                fmt(day.canteen.reduce((s, c) => s + c.notBilled, 0)),
                fmt(day.canteen.reduce((s, c) => s + c.billedLater, 0)),
                fmt(day.canteen.reduce((s, c) => s + c.oldOrdersBilled, 0)),
                ...(showFark ? [fmt(day.canteen.reduce((s, c) => s + c.fark, 0))] : []),
                fmt(day.canteen.reduce((s, c) => s + c.kulBill, 0)),
                fmt(day.canteen.reduce((s, c) => s + c.recvCash, 0)),
                fmt(day.canteen.reduce((s, c) => s + c.recvUpi, 0)),
              ],
            },
          ]}
        />
        <Note>
          'Abhi bill nahi hua' = us din ke orders jinka bill abhi tak nahi bana. 'Baad mein bill hua' = us din ke orders jinka bill doosre din bana.
          'Purane orders ka bill aaj bana' = pehle ke orders jinka bill us din bana (ek saath bill hone par). {showFark ? "'Baaki fark' = jin bills mein items order se alag the (checkout par badle). " : ""}
          'Cash / Account aaya' = us din is category ke liye jo paisa aaya (purane credit ka bhi).
          {day.orphanSale > 0 ? ` Menu se hata diye gaye items ka ${money(day.orphanSale)} bika, jo kisi category mein nahi aata.` : ""}
        </Note>
      </Section>

      {day.canteen.map((c) => {
        const withProfit = c.items.filter((it) => it.profit != null && it.qty > 0);
        return (
          <Section key={c.name} title={`${c.name} — ${dateLabel}`} breakBefore>
            <Tiles
              items={[
                { label: "Kitna bika", value: String(c.soldQty) },
                { label: "Bika (Rs)", value: money(c.sale), tone: "good" },
                { label: "Abhi bill nahi hua", value: money(c.notBilled), tone: "warn" },
                { label: "Cash aaya", value: money(c.recvCash) },
                { label: "Account aaya", value: money(c.recvUpi) },
              ]}
            />
            <Table
              cols={["Item", "Rate", "Kitna bika", "Bika (Rs)", "Abhi stock", "Profit"]}
              rows={[
                ...c.items.map((it) => ({
                  dim: it.qty === 0,
                  cells: [
                    it.name,
                    fmt(it.price),
                    it.qty || "-",
                    it.qty ? fmt(it.revenue) : "-",
                    it.left == null ? "-" : it.left,
                    it.profit == null || !it.qty ? "-" : fmt(it.profit),
                  ],
                })),
                {
                  bold: true,
                  cells: [
                    "TOTAL",
                    "",
                    c.soldQty,
                    fmt(c.sale),
                    "",
                    withProfit.length ? fmt(withProfit.reduce((s, it) => s + (it.profit ?? 0), 0)) : "-",
                  ],
                },
              ]}
            />
            <Note>Bika hua pehle, na bika hua neeche. "Abhi stock" aaj ka stock hai. Profit sirf unka jinka cost price set hai.</Note>
          </Section>
        );
      })}
    </div>
  );

  // The same day-wise figures added up month by month (credit given in that
  // month, how much of it has been paid, what's still owed).
  const creditMonths = (() => {
    if (!credit) return [];
    const byMonth = new Map<
      string,
      { cash: number; upi: number; issued: number; settled: number; pending: number; gallaCash: number; gallaUpi: number }
    >();
    for (const d of credit.days) {
      const k = d.dateKey.slice(0, 7);
      const m = byMonth.get(k) ?? { cash: 0, upi: 0, issued: 0, settled: 0, pending: 0, gallaCash: 0, gallaUpi: 0 };
      m.cash += d.cash;
      m.upi += d.upi;
      m.issued += d.issued;
      m.settled += d.settled;
      m.pending += d.pending;
      m.gallaCash += d.gallaCash;
      m.gallaUpi += d.gallaUpi;
      byMonth.set(k, m);
    }
    return [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  })();

  const monthView = month ? (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-2 print:hidden">
        <select
          value={monthKey}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
        >
          {allMonthKeys.map((k) => (
            <option key={k} value={k}>
              {formatDateKey(`${k}-01`, { month: "long", year: "numeric" })}
            </option>
          ))}
        </select>
      </div>

      <Section title={`1) GAMING — ${monthLabel}`}>
        <Tiles
          items={[
            { label: "Kul bill", value: money(month.gaming.billed) },
            { label: "Cash aaya", value: money(month.gaming.cash), tone: "good" },
            { label: "Account aaya", value: money(month.gaming.upi), tone: "good" },
            { label: "Credit diya (udhaar)", value: money(month.gaming.issued), tone: "warn" },
          ]}
        />
      </Section>

      <Section title={`2) CANTEEN — ${monthLabel}`}>
        <Tiles
          items={[
            { label: "Kul bill", value: money(month.canteen.billed) },
            { label: "Cash aaya", value: money(month.canteen.cash), tone: "good" },
            { label: "Account aaya", value: money(month.canteen.upi), tone: "good" },
            { label: "Credit diya (udhaar)", value: money(month.canteen.issued), tone: "warn" },
          ]}
        />
      </Section>

      <Section title="3) Kul galla — Gaming + Canteen (Cash aur Account alag)">
        <Table
          cols={["", "Cash", "Account", "Cash + Account"]}
          rows={[
            { cells: ["Gaming", dash(month.gaming.cash), dash(month.gaming.upi), dash(month.gaming.cash + month.gaming.upi)] },
            { cells: ["Canteen", dash(month.canteen.cash), dash(month.canteen.upi), dash(month.canteen.cash + month.canteen.upi)] },
            ...(Math.abs(month.other.cash) + Math.abs(month.other.upi) > 0.005
              ? [{ cells: ["Purana credit / advance (kisi se match nahi)", dash(month.other.cash), dash(month.other.upi), dash(month.other.cash + month.other.upi)] }]
              : []),
            { bold: true, cells: ["TOTAL galla", fmt(month.gallaCash), fmt(month.gallaUpi), fmt(month.gallaCash + month.gallaUpi)] },
            { cells: ["Kharcha", "", "", month.spent ? "-" + fmt(month.spent) : "-"] },
            { bold: true, cells: ["Kharcha ke baad bacha", "", "", fmt(month.gallaCash + month.gallaUpi - month.spent)] },
          ]}
        />
        <Note>
          Cash aaya / Account aaya = jo paisa us din gulle mein aaya. Purane credit ka paisa us business mein ginta hai jiska wo credit tha.
        </Note>
      </Section>

      <Section title="4) Din ke hisaab se" breakBefore>
        <Table
          cols={["Din", "Gaming Cash", "Gaming Account", "Gaming Credit", "Canteen Cash", "Canteen Account", "Canteen Credit", "Kul galla", "Kharcha"]}
          rows={[
            ...month.days.map((r) => ({
              cells: [
                r.label,
                dash(r.gaming.cash),
                dash(r.gaming.upi),
                dash(r.gaming.issued),
                dash(r.canteen.cash),
                dash(r.canteen.upi),
                dash(r.canteen.issued),
                dash(r.gallaCash + r.gallaUpi),
                dash(r.spent),
              ],
            })),
            {
              bold: true,
              cells: [
                "TOTAL",
                fmt(month.gaming.cash),
                fmt(month.gaming.upi),
                fmt(month.gaming.issued),
                fmt(month.canteen.cash),
                fmt(month.canteen.upi),
                fmt(month.canteen.issued),
                fmt(month.gallaCash + month.gallaUpi),
                fmt(month.spent),
              ],
            },
          ]}
        />
        <Note>Credit = us din jo udhaar gaya. Kul galla = Gaming + Canteen (+ purana credit / advance jo kisi se match nahi hua).</Note>
      </Section>
    </div>
  ) : null;

  const customerView = (
    <div className="space-y-4">
      <Section title="Customer-wise credit — mahine ke hisaab se">
        <Note>
          Har customer ne is mahine kitna credit liya, kitna chukaya, aur mahine ke end par kitna baaki hai. Ye wahi hisaab hai jo us customer ke
          apne ledger mein dikhta hai. Naam search karke kisi ka bhi mahine ka total dekh sakte ho (jaise salary se katne wale logon ka).
        </Note>
        <div className="grid grid-cols-2 gap-2 print:hidden">
          <select
            value={custMonthKey}
            onChange={(e) => setCustMonth(e.target.value)}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            {monthKeys.map((k) => (
              <option key={k} value={k}>
                {formatDateKey(`${k}-01`, { month: "long", year: "numeric" })}
              </option>
            ))}
          </select>
          <input
            value={custSearch}
            onChange={(e) => setCustSearch(e.target.value)}
            placeholder="Naam search karo…"
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          />
        </div>
        <Tiles
          items={[
            { label: "Credit liya", value: money(custShown.reduce((t, r) => t + r.added, 0)), tone: "warn" },
            { label: "Chukaya", value: money(custShown.reduce((t, r) => t + r.paid, 0)), tone: "good" },
            {
              label: "End mein baaki",
              value: money(custShown.reduce((t, r) => t + r.closing, 0)),
              tone: "bad",
              strong: true,
            },
          ]}
        />
        {custShown.length === 0 ? (
          <Note>Is mahine mein koi entry nahi{custSearch ? " (is naam ki)" : ""}.</Note>
        ) : (
          <Table
            cols={["Naam", "Shuru mein baaki", "Credit liya", "Isme Gaming", "Isme Canteen", "Chukaya", "End mein baaki"]}
            rows={[
              ...custShown.map((r) => ({ cells: [r.name, dash(r.opening), dash(r.added), dash(r.addedGaming), dash(r.addedCanteen), dash(r.paid), dash(r.closing)] })),
              {
                bold: true,
                cells: [
                  `TOTAL (${custShown.length} log)`,
                  fmt(custShown.reduce((t, r) => t + r.opening, 0)),
                  fmt(custShown.reduce((t, r) => t + r.added, 0)),
                  fmt(custShown.reduce((t, r) => t + r.addedGaming, 0)),
                  fmt(custShown.reduce((t, r) => t + r.addedCanteen, 0)),
                  fmt(custShown.reduce((t, r) => t + r.paid, 0)),
                  fmt(custShown.reduce((t, r) => t + r.closing, 0)),
                ],
              },
            ]}
          />
        )}
        <Note>
          "Credit liya" mein wo khana-peena bhi hai jo serve hua par abhi bill nahi bana (order ke din ke hisaab se). "Chukaya" mein cash, account aur
          maaf kiya hua sab hai.
        </Note>
      </Section>
    </div>
  );

  const creditView =
    credit && pending ? (
      <div className="space-y-6">
        <Section title="Credit hisaab — din ke hisaab se">
          <Tiles
            items={[
              { label: "Total credit diya", value: money(credit.total.issued), tone: "warn" },
              { label: "Total credit settle hua", value: money(credit.total.settled), tone: "good" },
              { label: "CREDIT BAAKI (abhi pending)", value: money(credit.total.pending), tone: "bad", strong: true },
            ]}
          />
          {creditMonths.length > 1 && (
            <>
              <p className="text-xs font-semibold pt-1">Mahine ke hisaab se</p>
              <Table
                cols={[
                  "Mahina",
                  "Credit diya",
                  "Credit settle hua",
                  "Credit baaki",
                  "Cash (bills ka)",
                  "Account (bills ka)",
                  "Galla Cash",
                  "Galla Account",
                ]}
                rows={creditMonths.map(([k, m]) => ({
                  cells: [
                    formatDateKey(`${k}-01`, { month: "long", year: "numeric" }),
                    dash(m.issued),
                    dash(m.settled),
                    dash(m.pending),
                    dash(m.cash),
                    dash(m.upi),
                    dash(m.gallaCash),
                    dash(m.gallaUpi),
                  ],
                }))}
              />
              <p className="text-xs font-semibold pt-1">Din ke hisaab se</p>
            </>
          )}
          <Table
            cols={[
              "Din",
              "Cash (bills ka)",
              "Account (bills ka)",
              "Credit diya",
              "Credit settle hua",
              "Credit baaki",
              "Galla Cash",
              "Galla Account",
            ]}
            rows={[
              ...credit.days.map((d) => ({
                cells: [
                  d.label,
                  dash(d.cash),
                  dash(d.upi),
                  dash(d.issued),
                  dash(d.settled),
                  dash(d.pending),
                  dash(d.gallaCash),
                  dash(d.gallaUpi),
                ],
              })),
              {
                bold: true,
                cells: [
                  "TOTAL",
                  fmt(credit.total.cash),
                  fmt(credit.total.upi),
                  fmt(credit.total.issued),
                  fmt(credit.total.settled),
                  fmt(credit.total.pending),
                  fmt(credit.total.gallaCash),
                  fmt(credit.total.gallaUpi),
                ],
              },
            ]}
          />
          <Note>
            Har din ki line mein: Credit diya − Credit settle hua = Credit baaki. "Cash/Account (bills ka)" = us din ke bills ka hisaab — jo paisa baad mein
            credit chukane mein aaya wo usi din mein gina gaya jis din ka credit tha. "Galla Cash/Account" = us din asal mein jo paisa aaya (Galla Summary
            jaisa). Dono ka total barabar hai, bas din alag-alag ho sakte hain.
            {credit.total.untracedCash + credit.total.untracedUpi > 0.005
              ? ` Isme ${money(credit.total.untracedCash + credit.total.untracedUpi)} aisa hai jo purane credit / advance ka tha aur kisi din se match nahi hua.`
              : ""}
          </Note>
        </Section>

        <Section title="Kiska credit baaki hai" breakBefore>
          <Tiles
            items={[
              { label: "Customers", value: money(pending.owingBilled) },
              { label: "Bina profile ke naam", value: money(pending.noProfileTotal) },
              { label: "KUL CREDIT BAAKI", value: money(pending.creditBaaki), tone: "bad", strong: true },
            ]}
          />
          <Table
            cols={["Naam", "Credit baaki (bill ho chuka)", "Serve hue, bill baaki", "Total baaki"]}
            rows={[
              ...pending.due.map((d) => ({
                dim: d.billed < 0,
                cells: [d.name, dash(d.billed), dash(d.notBilledYet), dash(d.total)],
              })),
              {
                bold: true,
                cells: ["TOTAL (Credits page jaisa)", fmt(pending.dueBilled), fmt(pending.dueNotBilledYet), fmt(pending.dueTotal)],
              },
            ]}
          />
          {pending.noProfile.length > 0 && (
            <>
              <p className="text-xs font-semibold pt-2">Bina profile ke baaki — Credits page pe nahi dikhta</p>
              <Table
                cols={["Naam / pehchaan", "Baaki"]}
                rows={[
                  ...pending.noProfile.map((n) => ({ cells: [n.name, fmt(n.amount)] })),
                  { bold: true, cells: ["TOTAL", fmt(pending.noProfileTotal)] },
                ]}
              />
            </>
          )}
          {pending.advance.length > 0 && (
            <>
              <p className="text-xs font-semibold pt-2">Advance — inhone credit se zyada de diya (inka kuch baaki nahi)</p>
              <Table
                cols={["Naam", "Zyada diya"]}
                rows={[
                  ...pending.advance.map((n) => ({ cells: [n.name, fmt(n.amount)] })),
                  { bold: true, cells: ["TOTAL", fmt(pending.advanceTotal)] },
                ]}
              />
              <Note>Ye ya to sach mein advance hai, ya settlement galat naam / profile pe chadh gayi.</Note>
            </>
          )}
          <p className="text-xs font-semibold pt-2">Hisaab milaan</p>
          <Table
            cols={["", "Rakam"]}
            rows={[
              { cells: ["Customers ka credit baaki (sirf jinka baaki hai)", money(pending.owingBilled)] },
              { cells: ["+ Bina profile ke baaki", money(pending.noProfileTotal)] },
              { bold: true, cells: ["= KUL CREDIT BAAKI (upar ke 'Credit baaki' ke barabar)", money(pending.creditBaaki)] },
              { cells: ["Credits page ke total tak: Customers ka credit baaki", money(pending.owingBilled)] },
              { cells: ["+ Serve hue par bill nahi bane (abhi credit nahi bana)", money(pending.dueNotBilledYet)] },
              ...(pending.advanceUsedOnPending > 0.005
                ? [{ cells: ["- Advance jo inhi orders mein adjust hua", "-" + money(pending.advanceUsedOnPending)] }]
                : []),
              { bold: true, cells: ["= Credits page ka total", money(pending.dueTotal)] },
            ]}
          />
          {pending.openSplitCredit > 0.005 && (
            <Note>
              Ek split bill abhi open hai, uska {money(pending.openSplitCredit)} credit hissa tab judega jab wo bill band hoga — upar ke kisi number mein
              nahi hai.
            </Note>
          )}
        </Section>
      </div>
    ) : null;

  return createPortal(
    <div className="hisaab-overlay fixed inset-0 z-[60] overflow-y-auto bg-[var(--color-bg)] text-[var(--color-text)]">
      <div id="hisaab-print" className="mx-auto max-w-3xl p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 print:hidden">
          <h2 className="text-base font-semibold">Hisaab Report</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadExcel}
              disabled={working}
              className="flex items-center gap-1.5 rounded-xl bg-[var(--color-success)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              <FileSpreadsheet size={14} /> {working ? "Ban raha hai…" : "Excel"}
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-xl bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white"
            >
              <Printer size={14} /> PDF / Print
            </button>
            <button
              onClick={onClose}
              className="h-9 w-9 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-dim)]"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 print:hidden">
          {(
            [
              { id: "day", label: "Ek din ka hisaab" },
              { id: "month", label: "Mahine ka hisaab" },
              { id: "credit", label: "Credit baaki (sab din)" },
              { id: "customer", label: "Customer-wise mahina" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                "rounded-xl border px-3 py-2 text-xs font-semibold " +
                (tab === t.id
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-dim)]")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "day" && (
          <div className="flex items-center justify-center gap-2 print:hidden">
            <button
              onClick={() => shiftDay(-1)}
              className="h-9 w-9 flex items-center justify-center rounded-xl bg-[var(--color-surface-2)]"
              aria-label="Pichla din"
            >
              <ChevronLeft size={16} />
            </button>
            <input
              type="date"
              value={date}
              max={toDateInputValue(openedAt)}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            />
            <button
              onClick={() => shiftDay(1)}
              disabled={date >= toDateInputValue(openedAt)}
              className="h-9 w-9 flex items-center justify-center rounded-xl bg-[var(--color-surface-2)] disabled:opacity-40"
              aria-label="Agla din"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <div className="text-center">
          <p className="text-lg font-bold">
            {tab === "day"
              ? `${dateLabel} — Din ka hisaab`
              : tab === "month"
                ? `${monthLabel} — Gaming aur Canteen`
                : tab === "customer"
                ? `Customer-wise credit — ${custMonthLabel}`
                : "Credit baaki — sab din"}
          </p>
          <p className="text-[11px] text-[var(--color-text-faint)]">
            {storeName} · {formatDateTime(openedAt)} tak ka data
          </p>
        </div>

        {tab === "day" ? dayView : tab === "month" ? monthView : tab === "customer" ? customerView : creditView}
      </div>
    </div>,
    document.body
  );
}
