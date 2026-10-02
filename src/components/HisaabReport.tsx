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
import { buildDayReport, dayReportSheets, type SheetSpec } from "../lib/dayReport";
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

export function HisaabReport({ initialDate, onClose }: { initialDate: string; onClose: () => void }) {
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

  const [tab, setTab] = useState<"day" | "credit">("day");
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
  const dayView = (
    <div className="space-y-6">
      <Section title="1) Us din kitna paisa aaya — Galla (Galla Summary jaisa)">
        <Tiles
          items={[
            { label: "Cash", value: money(galla.cash), tone: "good" },
            { label: "Account", value: money(galla.upi), tone: "good" },
            { label: "Kharcha", value: "-" + money(spent), tone: "bad" },
            { label: "Kharcha ke baad bacha", value: money(galla.cash + galla.upi - spent), strong: true },
          ]}
        />
        <Table
          cols={["", "Cash", "Account", "Cash + Account"]}
          rows={[
            { cells: ["Din ke naye bills", dash(g.freshCash), dash(g.freshUpi), dash(g.freshCash + g.freshUpi)] },
            {
              cells: [
                `Purana credit settle (${g.settledCount} logon ne)`,
                dash(g.settledCash),
                dash(g.settledUpi),
                dash(g.settledCash + g.settledUpi),
              ],
            },
            { bold: true, cells: ["TOTAL galla", fmt(galla.cash), fmt(galla.upi), fmt(galla.cash + galla.upi)] },
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
            { bold: true, cells: ["Kharcha ke baad bacha", "", "", fmt(galla.cash + galla.upi - spent)] },
          ]}
        />
        <Note>
          Galla = us din jo paisa gulle mein aaya, chahe wo kisi bhi din ke credit ka ho ({money(g.settledCash + g.settledUpi)} purane credit ka
          hai). Ye wahi hai jo Galla Summary mein dikhta hai.
        </Note>
      </Section>

      <Section title={`2) ${dateLabel} ka credit`}>
        <Tiles
          items={[
            { label: "Naya credit diya", value: money(d.issued), tone: "warn" },
            { label: "Isme se ab tak chuka", value: money(d.settled), tone: "good" },
            { label: "CREDIT BAAKI", value: money(d.pending), tone: "bad", strong: true },
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

      <Section title="3) Us din ke bills ka hisaab — galla se kaise milta hai">
        <Note>
          Jo paisa baad mein credit chukane mein aaya wo us din ke hisaab mein gina jaata hai jis din ka wo credit tha — isliye us din ke bills ka
          Cash/Account galla se alag hota hai. Ye milaan hai:
        </Note>
        <Table
          cols={["", "Cash", "Account"]}
          rows={[
            { cells: ["Galla — us din asal mein aaya", fmt(galla.cash), fmt(galla.upi)] },
            {
              cells: [
                "− Us din aaya, par dusre din ke credit ka tha (wahan gina gaya)",
                "-" + fmt(d.movedOutCash),
                "-" + fmt(d.movedOutUpi),
              ],
            },
            {
              cells: [
                "+ Dusre din aaya, par is din ke credit ka tha",
                "+" + fmt(d.movedInCash),
                "+" + fmt(d.movedInUpi),
              ],
            },
            { bold: true, cells: ["= Us din ke bills ka hisaab", fmt(d.cash), fmt(d.upi)] },
          ]}
        />
        <p className="text-xs font-semibold pt-2">Table aur Canteen ke hisse mein</p>
        <Table
          cols={["", "Cash", "Account", "Cash + Account", "Credit baaki"]}
          rows={day.dailyRows.map((r) => ({
            bold: r.item === "Total",
            cells: [
              r.item === "Total"
                ? "TOTAL"
                : r.item === "Credit settlement"
                  ? "Purane credit / advance (kisi din se match nahi)"
                  : r.item,
              dash(Number(r.cash)),
              dash(Number(r.upi)),
              dash(Number(r.cash) + Number(r.upi)),
              dash(Number(r.credit)),
            ],
          }))}
        />
        <Note>Food = Kitchen, Drinks = Fridge. Total wahi hai jo upar "= Us din ke bills ka hisaab" mein hai.</Note>
      </Section>

      <Section title="4) Canteen — category ke hisaab se" breakBefore>
        <Table
          cols={["Category", "Kitna bika", "Bika (Rs)", "Abhi bill nahi hua", "Bill mein Cash", "Account", "Credit baaki"]}
          rows={[
            ...day.canteen.map((c) => ({
              cells: [c.name, c.soldQty, fmt(c.sale), dash(c.notBilled), dash(c.cash), dash(c.upi), dash(c.credit)],
            })),
            {
              bold: true,
              cells: [
                "TOTAL",
                day.canteen.reduce((s, c) => s + c.soldQty, 0),
                fmt(day.canteen.reduce((s, c) => s + c.sale, 0)),
                fmt(day.canteen.reduce((s, c) => s + c.notBilled, 0)),
                fmt(day.canteen.reduce((s, c) => s + c.cash, 0)),
                fmt(day.canteen.reduce((s, c) => s + c.upi, 0)),
                fmt(day.canteen.reduce((s, c) => s + c.credit, 0)),
              ],
            },
          ]}
        />
        <Note>
          'Kitna bika' us din ke orders se hai (jaise Monthly Report mein). 'Bill mein' Cash / Account / Credit us din ke bills se hai.
          'Abhi bill nahi hua' = us din ke orders jinka bill abhi tak nahi bana. Order ek din ho sakta hai aur bill doosre din (jaise 24
          ghante baad apne aap credit mein jaana), isliye 'Bika' aur 'Bill mein' ka total hamesha barabar nahi hota.
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
                { label: "Bill mein Cash", value: money(c.cash) },
                { label: "Account", value: money(c.upi) },
                { label: "Credit baaki", value: money(c.credit), tone: "warn" },
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

        <div className="grid grid-cols-2 gap-2 print:hidden">
          {(
            [
              { id: "day", label: "Ek din ka hisaab" },
              { id: "credit", label: "Credit baaki (sab din)" },
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
            {tab === "day" ? `${dateLabel} — Din ka hisaab` : "Credit baaki — sab din"}
          </p>
          <p className="text-[11px] text-[var(--color-text-faint)]">
            {storeName} · {formatDateTime(openedAt)} tak ka data
          </p>
        </div>

        {tab === "day" ? dayView : creditView}
      </div>
    </div>,
    document.body
  );
}
