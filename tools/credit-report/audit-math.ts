// Independent check of the maths. Run: npx tsx audit-math.ts [backup.json]
//
// Everything below is worked out again FROM THE RAW BILLS with its own small code (it does not call
// billing.ts / ledger.ts / dayReport.ts to get an answer - those are only called at the end, to
// compare against). If the app and this file ever disagree, one of them has a mistake.
//
//   A. every bill adds up (total = table + canteen - discount; cash + account + credit = total)
//   B. day by day: Gaming and Canteen billed / cash / account / credit given / old-credit money
//   C. every customer's credit balance, and what is still owed on Gaming and on Canteen
//   D. the new payment screen's arithmetic, on 50,000 random bills (nothing lost, nothing made up)
import fs from "fs";
import path from "path";
import { creditBalanceFor, creditHisaab, gallaByDate, settleParts, businessTotals } from "../../src/lib/billing";
import { businessOfDay } from "../../src/lib/dayReport";
import { customerCreditByBusiness, creditByBusinessForAll } from "../../src/lib/ledger";

let failed = 0;
const say = (ok: boolean, name: string, extra = "") => {
  if (!ok) failed++;
  console.log(ok ? "OK  " : "FAIL", name, ok ? "" : extra);
};
const IST = 19_800_000;
const dayOf = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const isSettle = (b: any) => !b.tableId && b.tableName === "Credit settlement";

const srcPath = process.argv[2] ?? path.join(__dirname, "../../offline-pack/cuebill-data-backup.json");
const raw = JSON.parse(fs.readFileSync(srcPath, "utf8"));
const st = (k: string) => JSON.parse(raw[k]).state;
const bills: any[] = st("cuebill-bills").bills;
const orders: any[] = st("cuebill-orders").orders;
const customers: any[] = st("cuebill-customers").customers;
const menu = st("cuebill-menu");
const tables = st("cuebill-tables").tables;
const live = bills.filter((b) => b.status !== "cancelled");

// ============================================================ A. every bill adds up
{
  let badTotal = 0;
  let badPaid = 0;
  let writtenOff = 0;
  let badShares = 0;
  let noItems = 0;
  let noTable = 0;
  for (const b of live) {
    if (isSettle(b)) continue;
    if (Math.abs(b.tableCharge + b.canteenCharge - b.discount - b.total) > 0.011) badTotal++;
    if (b.canteenCharge > 0 && (b.canteenItems ?? []).length === 0) noItems++;
    if (b.tableCharge > 0 && !b.tableId) noTable++;
    if (b.shares) {
      const sum = b.shares.reduce((s: number, x: any) => s + x.amount, 0);
      if (Math.abs(sum - b.total) > 0.011) badShares++;
    } else if (b.status === "paid") {
      const left = b.total - b.amountCash - b.amountUpi - b.amountDue;
      if (Math.abs(left) > 0.011) {
        badPaid++;
        if (left > 0) writtenOff += left;
      }
    }
  }
  console.log(`   ${live.length} bills looked at`);
  say(badTotal === 0, "A1. every bill: table + canteen - discount = total", `${badTotal} bills differ`);
  say(badShares === 0, "A2. every split bill: the shares add up to the total", `${badShares} bills differ`);
  // bills whose credit was written off by hand (cash + account + credit < total) are real, counted as "maaf" - just report them
  console.log(`   NOTE A3: ${badPaid} paid bills have cash + account + credit below their total (Rs ${r2(writtenOff)} written off by hand) - the reports count this as maaf`);
  say(noItems === 0, "A4. every bill with canteen charge lists its items", `${noItems} bills have canteen money but no items (the day report cannot place that money)`);
  say(noTable === 0, "A5. every bill with table charge has a table", `${noTable} bills`);
}

// ============================================================ B. day by day, Gaming and Canteen
type M = { cash: number; upi: number };
type Day = {
  billed: { g: number; c: number };
  issued: { g: number; c: number };
  recv: { g: M; c: M; o: M };
};
const days = new Map<string, Day>();
const dayFor = (d: string): Day => {
  let x = days.get(d);
  if (!x) days.set(d, (x = { billed: { g: 0, c: 0 }, issued: { g: 0, c: 0 }, recv: { g: { cash: 0, upi: 0 }, c: { cash: 0, upi: 0 }, o: { cash: 0, upi: 0 } } }));
  return x;
};
// credit lumps per customer key, oldest first; advances (paid before anything was owed)
type Lump = { date: number; g: number; c: number; left: number; total: number };
type Adv = { day: string; cash: number; upi: number; amount: number };
const lumps = new Map<string, Lump[]>();
const advances = new Map<string, Adv[]>();
const firstIdByName = new Map<string, string>();
for (const c of customers) if (!firstIdByName.has(norm(c.name))) firstIdByName.set(norm(c.name), c.id);
const keyForName = (n: string) => firstIdByName.get(norm(n)) ?? `name:${norm(n)}`;

// who a share of money belongs to: gaming fraction of a share, by its label
const shareGamingFrac = (b: any, label: string) => {
  if (label === "Table charge") return 1;
  if (/^share$/i.test(label.trim())) {
    const raw = b.tableCharge + b.canteenCharge;
    return raw > 0 && b.tableId && b.tableCharge > 0 ? b.tableCharge / raw : 0;
  }
  return 0;
};

function addLump(key: string, date: number, g: number, c: number, dKey: string) {
  const total = g + c;
  if (total < 0.005) return;
  const q = lumps.get(key) ?? [];
  lumps.set(key, q);
  const lump: Lump = { date, g, c, left: total, total };
  q.push(lump);
  // an advance already sitting on this customer is used up first
  const pool = advances.get(key);
  while (pool && pool.length && lump.left > 0.005) {
    const a = pool[0];
    const take = Math.min(a.amount, lump.left);
    const f = take / a.amount;
    const cash = a.cash * f;
    const upi = a.upi * f;
    const gShare = lump.g / lump.total;
    // the money arrived on the advance's day; it was for this lump's businesses, not "unmatched"
    const arr = dayFor(a.day).recv;
    arr.o.cash -= cash; arr.o.upi -= upi;
    arr.g.cash += cash * gShare; arr.g.upi += upi * gShare;
    arr.c.cash += cash * (1 - gShare); arr.c.upi += upi * (1 - gShare);
    a.amount -= take; a.cash -= cash; a.upi -= upi;
    lump.left -= take;
    if (a.amount <= 0.005) pool.shift();
  }
  if (lump.left <= 0.005) q.pop();
  void dKey;
}

const sorted = live.slice().sort((a, b) => a.createdAt - b.createdAt);
for (const b of sorted) {
  const d = dayOf(b.createdAt);
  if (isSettle(b)) {
    if (b.status !== "paid") continue;
    const amount = r2(b.amountPaid + b.discount);
    if (amount <= 0.005) continue;
    const key = b.customerId ?? `name:${norm(b.tableName ?? "")}`;
    const q = lumps.get(key) ?? [];
    let left = amount;
    while (left > 0.005 && q.length) {
      const l = q[0];
      const take = Math.min(l.left, left);
      const f = take / amount;
      const gShare = l.g / l.total;
      const r = dayFor(d).recv;
      r.g.cash += b.amountCash * f * gShare; r.g.upi += b.amountUpi * f * gShare;
      r.c.cash += b.amountCash * f * (1 - gShare); r.c.upi += b.amountUpi * f * (1 - gShare);
      l.left -= take;
      left -= take;
      if (l.left <= 0.005) q.shift();
    }
    if (left > 0.005) {
      const f = left / amount;
      dayFor(d).recv.o.cash += b.amountCash * f;
      dayFor(d).recv.o.upi += b.amountUpi * f;
      const pool = advances.get(key) ?? [];
      pool.push({ day: d, cash: b.amountCash * f, upi: b.amountUpi * f, amount: left });
      advances.set(key, pool);
    }
    continue;
  }
  if (b.shares) {
    for (const s of b.shares) {
      if (s.status !== "paid" || !s.paymentMethod) continue;
      const gf = shareGamingFrac(b, s.label);
      const day = dayFor(d);
      // a credit share of a split bill that is still open is not billed yet (it counts once the bill closes)
      const countsAsBilled = s.paymentMethod !== "credit" || b.status === "paid";
      if (countsAsBilled) {
        day.billed.g += s.amount * gf;
        day.billed.c += s.amount * (1 - gf);
      }
      if (s.paymentMethod === "cash" || s.paymentMethod === "upi") {
        const m = s.paymentMethod === "cash" ? "cash" : "upi";
        day.recv.g[m] += s.amount * gf;
        day.recv.c[m] += s.amount * (1 - gf);
      } else if (s.paymentMethod === "credit" && b.status === "paid") {
        day.issued.g += s.amount * gf;
        day.issued.c += s.amount * (1 - gf);
        addLump(keyForName(s.payerName), b.createdAt, s.amount * gf, s.amount * (1 - gf), d);
      }
    }
    continue;
  }
  if (b.status !== "paid") continue;
  const raw = b.tableCharge + b.canteenCharge;
  const gf = raw > 0 ? b.tableCharge / raw : 0;
  const day = dayFor(d);
  day.billed.g += b.total * gf;
  day.billed.c += b.total * (1 - gf);
  day.recv.g.cash += b.amountCash * gf; day.recv.c.cash += b.amountCash * (1 - gf);
  day.recv.g.upi += b.amountUpi * gf; day.recv.c.upi += b.amountUpi * (1 - gf);
  day.issued.g += b.amountDue * gf; day.issued.c += b.amountDue * (1 - gf);
  if (b.customerId && b.amountDue > 0.005) addLump(b.customerId, b.createdAt, b.amountDue * gf, b.amountDue * (1 - gf), d);
}

{
  const h = creditHisaab(live, menu.items, menu.categories, tables, customers);
  const galla = gallaByDate(live);
  const app = new Map(h.days.map((x) => [x.dateKey, businessOfDay(x)]));
  const tol = 0.05;
  const names = ["billed Gaming", "billed Canteen", "credit given Gaming", "credit given Canteen", "cash Gaming", "account Gaming", "cash Canteen", "account Canteen", "cash unmatched", "account unmatched"];
  const bad = new Array(names.length).fill(0);
  const first: string[] = [];
  let badGalla = 0;
  for (const [d, mine] of days) {
    const a = app.get(d);
    if (!a) {
      const any = mine.billed.g + mine.billed.c + mine.recv.g.cash + mine.recv.c.cash + mine.recv.o.cash;
      if (Math.abs(any) > tol) { badGalla++; first.push(`${d}: app has no row`); }
      continue;
    }
    const pairs: [number, number][] = [
      [mine.billed.g, a.gamingTotal.billed], [mine.billed.c, a.canteenTotal.billed],
      [mine.issued.g, a.gamingTotal.issued], [mine.issued.c, a.canteenTotal.issued],
      [mine.recv.g.cash, a.gamingTotal.cash], [mine.recv.g.upi, a.gamingTotal.upi],
      [mine.recv.c.cash, a.canteenTotal.cash], [mine.recv.c.upi, a.canteenTotal.upi],
      [mine.recv.o.cash, a.other.cash], [mine.recv.o.upi, a.other.upi],
    ];
    pairs.forEach(([x, y], i) => {
      if (Math.abs(x - y) > tol) {
        bad[i]++;
        if (first.length < 6) first.push(`${d} ${names[i]}: mine ${r2(x)} app ${r2(y)}`);
      }
    });
    const g = galla.get(d);
    const gc = (g?.freshCash ?? 0) + (g?.settledCash ?? 0);
    const gu = (g?.freshUpi ?? 0) + (g?.settledUpi ?? 0);
    const mc = mine.recv.g.cash + mine.recv.c.cash + mine.recv.o.cash;
    const mu = mine.recv.g.upi + mine.recv.c.upi + mine.recv.o.upi;
    if (Math.abs(mc - gc) > tol || Math.abs(mu - gu) > tol) badGalla++;
  }
  console.log(`   ${days.size} days worked out again`);
  names.forEach((n, i) => say(bad[i] === 0, `B${i + 1}. every day: ${n} - my figure = the app's`, `${bad[i]} days differ`));
  say(badGalla === 0, "B11. every day: my Gaming + Canteen + unmatched cash/account = the real galla", `${badGalla} days differ`);
  if (first.length) console.log("      first differences:\n      " + first.join("\n      "));
  // totals over the whole history
  let gc = 0, gu = 0, cc = 0, cu = 0, gi = 0, ci = 0;
  for (const m of days.values()) { gc += m.recv.g.cash; gu += m.recv.g.upi; cc += m.recv.c.cash; cu += m.recv.c.upi; gi += m.issued.g; ci += m.issued.c; }
  console.log(`   by my own count, whole history:  Gaming cash ${r2(gc)} account ${r2(gu)} credit given ${r2(gi)}  |  Canteen cash ${r2(cc)} account ${r2(cu)} credit given ${r2(ci)}`);
}

// ============================================================ C. every customer's balance
{
  // C1 - the plain total: every credit given minus every payment, no ordering involved
  let bad1 = 0;
  const first: string[] = [];
  for (const c of customers) {
    if (c.isWalkIn) continue;
    const key = norm(c.name);
    let bal = 0;
    for (const b of live) {
      if (b.status !== "paid") continue;
      const mine = b.shares ? b.shares.some((s: any) => norm(s.payerName) === key) : b.customerId === c.id;
      if (!mine) continue;
      if (isSettle(b)) bal -= b.amountPaid + b.discount;
      else if (b.shares) bal += b.shares.filter((s: any) => s.status === "paid" && s.paymentMethod === "credit" && norm(s.payerName) === key).reduce((x: number, s: any) => x + s.amount, 0);
      else bal += b.amountDue;
    }
    const app = creditBalanceFor(bills, c.id, key);
    if (Math.abs(bal - app) > 0.011) { bad1++; if (first.length < 5) first.push(`${c.name}: mine ${r2(bal)} app ${app}`); }
  }
  say(bad1 === 0, "C1. every customer: credit given - paid = the app's credit balance", `${bad1} customers differ: ${first.join("; ")}`);

  // C2 - what is still owed on Gaming and on Canteen, oldest debt cleared first
  const billedOrderIds = new Set(live.filter((b) => b.orderId).map((b) => b.orderId));
  let bad2 = 0;
  let owing = 0;
  let sumG = 0, sumC = 0, sumApp = 0;
  const first2: string[] = [];
  for (const c of customers) {
    if (c.isWalkIn) continue;
    const key = norm(c.name);
    type Ev = { t: number; kind: "debt" | "pay"; g: number; c: number; amount: number };
    const ev: Ev[] = [];
    for (const b of live) {
      const mine = b.shares ? b.shares.some((s: any) => norm(s.payerName) === key) : b.customerId === c.id;
      if (!mine) continue;
      if (isSettle(b)) { if (b.status === "paid") ev.push({ t: b.createdAt, kind: "pay", g: 0, c: 0, amount: b.amountPaid + b.discount }); continue; }
      if (b.shares) {
        if (b.status !== "paid") continue; // a split bill's credit counts once the bill is closed
        for (const s of b.shares) {
          if (s.status !== "paid" || s.paymentMethod !== "credit" || norm(s.payerName) !== key) continue;
          const gf = shareGamingFrac(b, s.label);
          ev.push({ t: b.createdAt, kind: "debt", g: s.amount * gf, c: s.amount * (1 - gf), amount: s.amount });
        }
        continue;
      }
      const raw = b.tableCharge + b.canteenCharge;
      const gf = raw > 0 ? b.tableCharge / raw : 0;
      if (b.amountDue > 0.005) ev.push({ t: b.createdAt, kind: "debt", g: b.amountDue * gf, c: b.amountDue * (1 - gf), amount: b.amountDue }); // paid or still open
    }
    for (const o of orders) {
      if (o.customerId !== c.id || o.status !== "served" || billedOrderIds.has(o.id)) continue;
      const amt = o.items.reduce((s: number, i: any) => s + i.price * i.qty, 0);
      ev.push({ t: o.createdAt, kind: "debt", g: 0, c: amt, amount: amt });
    }
    ev.sort((a, b) => a.t - b.t);
    const q: { g: number; c: number; left: number; total: number }[] = [];
    let adv = 0;
    for (const e of ev) {
      if (e.kind === "debt") {
        let g = e.g, cc = e.c;
        const tot = g + cc;
        if (adv > 0.005 && tot > 0.005) { const take = Math.min(adv, tot); g -= (g * take) / tot; cc -= (cc * take) / tot; adv -= take; }
        if (g + cc > 0.005) q.push({ g, c: cc, left: g + cc, total: g + cc });
      } else {
        let left = e.amount;
        while (left > 0.005 && q.length) {
          const l = q[0];
          const take = Math.min(l.left, left);
          const tg = (l.g / l.left) * take; // this lump's own mix, as it stands now
          l.g -= tg; l.c -= take - tg; l.left -= take;
          left -= take;
          if (l.left <= 0.005) q.shift();
        }
        if (left > 0.005) adv += left;
      }
    }
    const g = q.reduce((s, l) => s + l.g, 0);
    const cc = q.reduce((s, l) => s + l.c, 0);
    const app = customerCreditByBusiness(c, bills, orders);
    if (g + cc > 0.005 || app.gaming + app.canteen > 0.005) {
      owing++;
      sumG += g; sumC += cc; sumApp += app.gaming + app.canteen;
      if (Math.abs(g - app.gaming) > 0.02 || Math.abs(cc - app.canteen) > 0.02) { bad2++; if (first2.length < 6) first2.push(`${c.name}: mine G ${r2(g)} C ${r2(cc)} | app G ${app.gaming} C ${app.canteen}`); }
    }
  }
  const all = creditByBusinessForAll(customers, bills, orders);
  let badAll = 0;
  for (const c of customers) {
    if (c.isWalkIn) continue;
    const one = customerCreditByBusiness(c, bills, orders);
    const x = all.get(c.id)!;
    if (Math.abs(one.gaming - x.gaming) > 0.001 || Math.abs(one.canteen - x.canteen) > 0.001) badAll++;
  }
  say(badAll === 0, "C3. the Credits page's all-customers figure = the one-customer figure, for every customer", `${badAll} differ`);
  console.log(`   ${owing} customers have something owed; by my count Gaming ${r2(sumG)} + Canteen ${r2(sumC)} = ${r2(sumG + sumC)} (app total ${r2(sumApp)})`);
  say(bad2 === 0, "C2. every customer: still owed on Gaming and on Canteen - my figure = the app's", `${bad2} customers differ: ${first2.join("; ")}`);
}

// ============================================================ D. the payment screen, 50,000 random bills
{
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const money = (max: number) => (rnd() < 0.5 ? Math.floor(rnd() * max) : r2(rnd() * max));
  let bad = 0;
  const first: string[] = [];
  for (let i = 0; i < 50_000; i++) {
    const tableCharge = rnd() < 0.2 ? 0 : Math.floor(rnd() * 600);
    const canteenCharge = rnd() < 0.2 ? 0 : Math.floor(rnd() * 400);
    const discount = rnd() < 0.5 ? 0 : money(tableCharge + canteenCharge + 50);
    const bill = { tableCharge, canteenCharge, discount };
    const total = Math.max(0, tableCharge + canteenCharge - Math.min(discount, tableCharge + canteenCharge));
    const t = businessTotals(bill);
    const p = settleParts(bill, {
      gaming: { cash: money(t.gaming + 80) - (rnd() < 0.05 ? 5 : 0), upi: money(t.gaming + 80) },
      canteen: { cash: money(t.canteen + 80), upi: money(t.canteen + 80) - (rnd() < 0.05 ? 5 : 0) },
    });
    const problems: string[] = [];
    if (Math.abs(t.gaming + t.canteen - total) > 0.011) problems.push("business totals do not add to the bill total");
    for (const [name, x] of [["gaming", p.gaming], ["canteen", p.canteen]] as const) {
      if (x.cash < -1e-9 || x.upi < -1e-9 || x.due < -0.011) problems.push(`${name} has a negative part`);
      if (Math.abs(x.cash + x.upi + x.due - x.total) > 0.011) problems.push(`${name}: cash + account + credit != its total`);
      if (x.cash + x.upi > x.total + 0.011) problems.push(`${name}: took in more than it billed`);
    }
    if (Math.abs(p.gaming.total + p.canteen.total - total) > 0.011) problems.push("parts do not add to the bill total");
    if (problems.length) { bad++; if (first.length < 4) first.push(JSON.stringify({ bill, p }) + " -> " + problems.join(", ")); }
  }
  say(bad === 0, "D1. 50,000 random bills: each business's cash + account + credit = its bill, no negatives, nothing over-taken, parts add to the total", `${bad} bad: ${first.join(" || ")}`);

  // D2 - the khata's per-business book: random charges and payments, against a plain re-count
  const { buildLedger } = require("../../src/lib/ledger");
  let badLedger = 0;
  const firstL: string[] = [];
  for (let trial = 0; trial < 4000; trial++) {
    const n = 2 + Math.floor(rnd() * 9);
    const list: any[] = [];
    let t = Date.UTC(2026, 9, 1);
    let owedG = 0, owedC = 0, totalDebt = 0, totalPaid = 0;
    for (let i = 0; i < n; i++) {
      t += 3_600_000;
      if (i > 0 && rnd() < 0.4) {
        const amount = Math.floor(rnd() * 400);
        list.push({ id: "s" + i, tableId: null, tableName: "Credit settlement", status: "paid", customerId: "c", shares: null, tableCharge: 0, canteenCharge: 0, canteenItems: [], discount: 0, total: amount, amountPaid: amount, amountCash: amount, amountUpi: 0, amountDue: 0, createdAt: t, orderId: null });
        totalPaid += amount;
      } else {
        const g = Math.floor(rnd() * 300), c = Math.floor(rnd() * 300);
        list.push({ id: "b" + i, tableId: g > 0 ? "t" : null, tableName: "x", status: "paid", customerId: "c", shares: null, tableCharge: g, canteenCharge: c, canteenItems: [], discount: 0, total: g + c, amountPaid: 0, amountCash: 0, amountUpi: 0, amountDue: g + c, createdAt: t, orderId: null, parts: { gaming: { total: g, cash: 0, upi: 0, due: g }, canteen: { total: c, cash: 0, upi: 0, due: c } } });
        totalDebt += g + c;
      }
    }
    void owedG; void owedC;
    const entries = buildLedger(list, [], "x", []);
    const last = entries[0];
    const balance = totalDebt - totalPaid;
    // while nothing has been over-paid the two businesses must add up to the balance, and never go negative
    const overpaid = (() => { let run = 0; let min = 0; for (const b of list.slice().sort((a, b) => a.createdAt - b.createdAt)) { run += b.amountDue - (b.tableName === "Credit settlement" ? b.amountPaid : 0); min = Math.min(min, run); } return min < -0.005; })();
    if (last.gamingAfter < -0.005 || last.canteenAfter < -0.005) { badLedger++; if (firstL.length < 3) firstL.push("negative part"); continue; }
    if (!overpaid && Math.abs(last.gamingAfter + last.canteenAfter - balance) > 0.02) { badLedger++; if (firstL.length < 3) firstL.push(`parts ${last.gamingAfter}+${last.canteenAfter} != balance ${balance}`); }
  }
  say(badLedger === 0, "D2. 4,000 random khatas: Gaming + Canteen owed = the balance (when never over-paid), never negative", `${badLedger} bad: ${firstL.join(" | ")}`);
}

console.log(failed === 0 ? "\nALL MATHS CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
