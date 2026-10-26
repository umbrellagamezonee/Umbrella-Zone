// End-to-end check of the new billing: Gaming and Canteen on one bill, paid separately, the Customer
// Bill, credit only for regulars, the ledger / Credits split, and the business-wise reports.
//   node test-billing.js [--exe path\to\CueBill.exe] [--dir work-folder]
// Runs on a scratch data folder (the old data is loaded into it, then three test bills are added).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { harness } = require("./e2e-lib");
const { DataStore } = require("./storage");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const work = arg("--dir") || path.join(os.tmpdir(), "cuebill-e2e-billing");
fs.rmSync(work, { recursive: true, force: true });
const H = harness({ work, exe: arg("--exe") });
const { check, sleep, clickText, setNumber, text, waitFor, shot, unlock, go, stateOf } = H;

const uuid = () => require("crypto").randomUUID();
const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);

async function openBill(c, who) {
  await go(c, "/", PIN);
  await waitFor(c, `document.body.innerText.includes(${JSON.stringify(who)})`, who + " on Home");
  await sleep(500);
  await clickText(c, who, { tag: "p" });
  await waitFor(c, "document.body.innerText.includes('PAYMENT KAISE HUA')", "checkout open for " + who);
}
const confirmButton = (c) =>
  c.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => /^Confirm/.test(x.textContent.trim())); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; })()`);
const billOf = (c, id) => c.eval(`${stateOf("cuebill-bills")}.bills.find((b) => b.id === ${JSON.stringify(id)})`);

let PIN = "0000";

(async () => {
  // ---------- set up: load the old data, then add three open test bills ----------
  console.log("== Setup ==");
  H.launch();
  let c = await H.connect();
  PIN = JSON.parse(JSON.parse(fs.readFileSync(path.join(__dirname, "pack-data", "initial-data", "cuebill-data-backup.json"), "utf8"))["cuebill-settings"]).state.appPassword;
  await unlock(c, PIN);
  await sleep(1500);
  c.close();
  H.hardKill();
  await sleep(1500);

  const store = new DataStore(H.DATA);
  const parse = (k) => JSON.parse(store.snapshot()[k]);
  const billsDoc = parse("cuebill-bills");
  const custDoc = parse("cuebill-customers");
  const table = parse("cuebill-tables").state.tables[0];
  const regular = { id: uuid(), name: "Test Regular", phone: "", email: "", isWalkIn: false, lastReminderAt: null, createdAt: Date.now(), isRegular: true };
  const oneTime = { id: uuid(), name: "Test OneTime", phone: "", email: "", isWalkIn: false, lastReminderAt: null, createdAt: Date.now() };
  custDoc.state.customers.push(regular, oneTime);
  const seedBill = (o) => ({
    id: uuid(), tableId: null, tableName: null, orderId: null, gameId: null, gameName: null, customerId: null,
    tableChargeMinutes: 0, tableCharge: 0, canteenCharge: 0, canteenItems: [], discount: 0, total: 0,
    amountPaid: 0, amountCash: 0, amountUpi: 0, amountDue: 0, paymentMethod: null, shares: null, status: "open",
    createdAt: Date.now(), paidAt: null, deletedAt: null, matchParticipants: null, matchLosers: null, ...o,
  });
  const items = [
    { name: "Maggi", price: 50, qty: 1, personName: null },
    { name: "Coke", price: 40, qty: 1, personName: null },
  ];
  const B1 = seedBill({ tableId: table.id, tableName: table.name, tableChargeMinutes: 60, tableCharge: 100, canteenCharge: 90, canteenItems: items, total: 190, amountDue: 190, customerId: regular.id });
  const B2 = seedBill({ tableId: table.id, tableName: table.name, tableChargeMinutes: 30, tableCharge: 60, canteenCharge: 40, canteenItems: [items[1]], total: 100, amountDue: 100, customerId: oneTime.id });
  const O3 = { id: uuid(), tableId: null, customerId: null, guestName: "Walk-in guest", items: [{ id: uuid(), qty: 1, name: "Cold coffee", price: 80, menuItemId: parse("cuebill-menu").state.items[0].id }], note: "", status: "billed", createdAt: Date.now() };
  const B3 = seedBill({ orderId: O3.id, tableName: "Canteen order", canteenCharge: 80, canteenItems: [{ name: "Cold coffee", price: 80, qty: 1, personName: null }], total: 80, amountDue: 80 });
  const share = (label, payerName, amount) => ({ id: uuid(), label, payerName, payerPhone: "", amount, paymentMethod: null, status: "pending", paidAt: null });
  const B4 = seedBill({
    tableId: table.id, tableName: table.name, tableChargeMinutes: 40, tableCharge: 100, canteenCharge: 40, canteenItems: [{ name: "Chips", price: 40, qty: 1, personName: null }], total: 140, amountDue: 140,
    matchParticipants: ["Split A", "Split B"],
    shares: [share("Table charge", "Split A", 50), share("Table charge", "Split B", 50), share("Food", "Split A", 20), share("Food", "Split B", 20)],
  });
  const ordersDoc = parse("cuebill-orders");
  ordersDoc.state.orders.unshift(O3);
  billsDoc.state.bills.unshift(B4, B3, B2, B1);
  store.apply({ "cuebill-bills": JSON.stringify(billsDoc), "cuebill-customers": JSON.stringify(custDoc), "cuebill-orders": JSON.stringify(ordersDoc) });
  store.flushNow();
  console.log(`   test bills added: ${B1.total} (regular), ${B2.total} (one-time), ${B3.total} (walk-in canteen)`);

  // ---------- 1. the regular customer's mixed bill ----------
  console.log("\n== 1. Mixed bill, regular customer ==");
  H.launch();
  c = await H.connect();
  await unlock(c, PIN);
  await openBill(c, "Test Regular");
  let t = await text(c);
  check("checkout shows Gaming and Canteen on their own", /Gaming/.test(t) && /Canteen/.test(t) && /Customer Bill/.test(t), JSON.stringify(t.slice(-700)));
  check("...each with its own Cash / Account / Credit", (t.match(/Credit \(baaki\)/g) || []).length === 2);
  await shot(c, "1-checkout");

  await clickText(c, "Customer Bill (customer ko dikhao)", { exact: false });
  await sleep(500);
  t = await text(c);
  check("Customer Bill slip: GAMING and CANTEEN sections and the total", /GAMING/.test(t) && /CANTEEN/.test(t) && /Kul bill/.test(t) && /190/.test(t) && /Maggi/.test(t));
  check("Customer Bill slip: gaming 100 and canteen 90 shown apart", /Gaming total\s*₹100/.test(t) && /Canteen total\s*₹90/.test(t), t.slice(-400));
  await shot(c, "2-customer-bill");
  await clickText(c, "PDF / Print", { exact: false, tag: "button" });
  await sleep(2500);
  const slipPdf = H.newest(H.DL, ".pdf");
  check("Customer Bill saves as a PDF file", !!slipPdf && fs.statSync(slipPdf).size > 2000, String(slipPdf));
  if (slipPdf) fs.copyFileSync(slipPdf, path.join(H.SHOTS, "customer-bill.pdf"));
  await c.eval(`document.querySelector(".print-slip button[aria-label=Close]")?.click()`);
  await sleep(400);

  // gaming all cash (100), canteen: 40 by account, the other 50 stays credit
  await setNumber(c, 0, 100);
  await setNumber(c, 3, 40);
  await sleep(300);
  t = await text(c);
  check("summary: Cash 100, Account 40, Credit 50", /Cash\s*₹100/.test(t) && /Account\s*₹40/.test(t) && /Credit\s*₹50/.test(t), t.slice(-500));
  let btn = await confirmButton(c);
  check("confirm button says how much goes on credit", !!btn && /50 credit mein/.test(btn.text) && !btn.disabled, JSON.stringify(btn));
  await clickText(c, btn.text, { exact: true, tag: "button" });
  await sleep(800);
  t = await text(c);
  check("success screen: gaming and canteen each say how they were paid", /Gaming ₹100:\s*Cash ₹100/.test(t) && /Canteen ₹90:\s*Account ₹40 · Credit ₹50/.test(t), t.slice(0, 400));
  check("success screen: credit went to Test Regular", /added to Test Regular's credit/.test(t));
  let b1 = await billOf(c, B1.id);
  check("saved bill remembers the exact split", JSON.stringify(b1.parts) === JSON.stringify({ gaming: { total: 100, cash: 100, upi: 0, due: 0 }, canteen: { total: 90, cash: 0, upi: 40, due: 50 } }), JSON.stringify(b1 && b1.parts));
  check("saved bill totals: cash 100, account 40, credit 50", b1.amountCash === 100 && b1.amountUpi === 40 && b1.amountDue === 50 && b1.status === "paid");
  await clickText(c, "Customer Bill", { exact: true, tag: "button" });
  await sleep(500);
  t = await text(c);
  check("paid Customer Bill also lists how each business was paid", /PAYMENT/.test(t) && /Gaming\s*Cash ₹100/.test(t) && /Canteen\s*Account ₹40 · Credit ₹50/.test(t), t.slice(-300));
  await c.eval(`document.querySelector(".print-slip button[aria-label=Close]")?.click()`);
  await sleep(300);
  await clickText(c, "Done", { exact: true, tag: "button" });

  // ---------- 2. one-time customer: no credit ----------
  console.log("\n== 2. One-time customer cannot take credit ==");
  await openBill(c, "Test OneTime");
  await clickText(c, "Sab Credit", { exact: true, tag: "button" });
  await sleep(400);
  t = await text(c);
  btn = await confirmButton(c);
  check("one-time customer: credit is blocked with a clear message", /regular customer nahi hai/.test(t) && !!btn && btn.disabled, JSON.stringify(btn));
  await shot(c, "3-not-regular");
  await clickText(c, "Sab Cash", { exact: true, tag: "button" });
  await sleep(300);
  btn = await confirmButton(c);
  check("...but paying in cash works", !!btn && !btn.disabled && /^Confirm payment/.test(btn.text), JSON.stringify(btn));
  await clickText(c, btn.text, { exact: true, tag: "button" });
  await sleep(800);
  const b2 = await billOf(c, B2.id);
  check("one-time bill: gaming 60 cash and canteen 40 cash, no credit", JSON.stringify(b2.parts) === JSON.stringify({ gaming: { total: 60, cash: 60, upi: 0, due: 0 }, canteen: { total: 40, cash: 40, upi: 0, due: 0 } }), JSON.stringify(b2 && b2.parts));
  const stillOneTime = await c.eval(`${stateOf("cuebill-customers")}.customers.find((x) => x.name === "Test OneTime").isRegular === undefined`);
  check("...and the customer stays a one-time customer", stillOneTime);
  await clickText(c, "Done", { exact: true, tag: "button" });

  // ---------- 3. walk-in canteen bill on credit to a regular ----------
  console.log("\n== 3. Walk-in canteen bill, credit to a regular ==");
  await go(c, "/canteen", PIN);
  await waitFor(c, "document.body.innerText.includes('Cold coffee x1')", "walk-in order on the Canteen page");
  await sleep(500);
  await clickText(c, "Cold coffee x1", { tag: "p" });
  await waitFor(c, "document.body.innerText.includes('PAYMENT KAISE HUA')", "checkout open for the canteen bill");
  await sleep(300);
  await clickText(c, "Sab Credit", { exact: true, tag: "button" });
  await sleep(400);
  t = await text(c);
  btn = await confirmButton(c);
  check("walk-in: asks which regular customer, confirm is blocked", /kis regular customer par/.test(t) && !!btn && btn.disabled, JSON.stringify(btn));
  await H.typeInto(c, 'input[placeholder="Regular customer ka naam"]', "Test Regular");
  await sleep(500);
  btn = await confirmButton(c);
  check("naming a regular customer unlocks confirm", !!btn && !btn.disabled && /80 credit mein/.test(btn.text), JSON.stringify(btn));
  await clickText(c, btn.text, { exact: true, tag: "button" });
  await sleep(800);
  const b3 = await billOf(c, B3.id);
  check("canteen-only bill: all 80 is canteen credit", JSON.stringify(b3.parts) === JSON.stringify({ gaming: { total: 0, cash: 0, upi: 0, due: 0 }, canteen: { total: 80, cash: 0, upi: 0, due: 80 } }) && b3.customerId === regular.id, JSON.stringify(b3 && b3.parts));
  await clickText(c, "Done", { exact: true, tag: "button" });

  // ---------- 4. Credits page and the customer's ledger ----------
  console.log("\n== 4. Credits and ledger ==");
  await go(c, "/credits", PIN);
  t = await text(c);
  const card = await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "Test Regular"); return p ? p.closest("[class*=border]").innerText : null; })()`);
  check("Credits page lists Test Regular with 130 split into Gaming 0 / Canteen 130", !!card && /130/.test(card) && /Gaming\s*₹0/.test(card) && /Canteen\s*₹130/.test(card), String(card));
  check("Credits page has Gaming and Canteen totals", /GAMING KA BAAKI/.test(t) && /CANTEEN KA BAAKI/.test(t));
  check("Credits page has no Remind button, only Settle", !/Remind/.test(t) && /Settle/.test(t));
  await shot(c, "4-credits");

  // paying 60 against the 130 of canteen credit: the oldest credit (the 50) goes first, then 10 of the 80
  await H.typeInto(c, 'input[placeholder="Search name, phone"]', "Test Regular");
  await sleep(500);
  await clickText(c, "Settle", { exact: true, tag: "button" });
  await waitFor(c, "document.body.innerText.includes('Total due')", "Settle screen");
  await sleep(300);
  t = await text(c);
  check("Settle screen: total due 130, split Gaming 0 / Canteen 130", /Total due\s*₹130/.test(t) && /Gaming ka\s*₹0/.test(t) && /Canteen ka\s*₹130/.test(t), t.slice(0, 500));
  await setNumber(c, 1, 60); // 0 = discount, 1 = cash, 2 = account
  await sleep(300);
  await clickText(c, "Settle", { exact: true, tag: "button" });
  await sleep(800);
  t = await text(c);
  check("Settle: says what it cleared (Canteen 60) and what is left (70)", /Isse chuka:\s*Canteen ₹60/.test(t) && /₹70 still due/.test(t), t.slice(0, 500));
  await clickText(c, "Done", { exact: true, tag: "button" });
  await sleep(500);
  await go(c, "/credits", PIN);
  const card2 = await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "Test Regular"); return p ? p.closest("[class*=border]").innerText : null; })()`);
  check("Credits page after settling: Test Regular owes 70, all Canteen", !!card2 && /70/.test(card2) && /Gaming\s*₹0/.test(card2) && /Canteen\s*₹70/.test(card2), String(card2));

  await go(c, "/customers", PIN);
  await clickText(c, "Test Regular", { exact: false, tag: "p" });
  await sleep(700);
  t = await text(c);
  check("customer profile: marked Regular, Gaming and Canteen baaki", /Regular customer \(credit milega\)/.test(t) && /Gaming ka baaki/.test(t) && /Canteen ka baaki/.test(t));
  check("ledger lines say Canteen ₹50 and Canteen ₹80, and the payment cleared Canteen ₹60", /Canteen ₹50/.test(t) && /Canteen ₹80/.test(t) && /Chukaya: Canteen ₹60/.test(t) && /Baaki: Canteen ₹70/.test(t), t.slice(0, 900));
  await shot(c, "5-ledger");

  // ---------- 5. reports ----------
  console.log("\n== 5. Reports ==");
  await go(c, "/reports", PIN);
  t = await text(c);
  const box = await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "AAJ"); return p ? p.parentElement.innerText : null; })()`);
  // gaming: cash 160 | canteen: cash 40, account 40, credit 130 | total: cash 200, account 40, credit 130
  const nums = (box || "").replace(/₹/g, "").split(/\s+/);
  check("home: Gaming cash 160 and Canteen cash 100 (40 + 60 old credit) / account 40 / credit 130 for today", /Gaming\s+160/.test((box || "").replace(/₹/g, "")) && /Canteen\s+100\s+40\s+130/.test((box || "").replace(/₹/g, "")), String(box));
  check("home: total row Cash 260, Account 40, Credit 130", /Kul\s+260\s+40\s+130/.test((box || "").replace(/₹/g, "")), nums.join(" "));
  check("home: Cash in drawer counts only cash (260), account shown separately", /₹260/.test(t) && /Account \(₹40 aaj\)/.test(t), t.slice(0, 300));
  check("home: the old mixed 'TOTAL COLLECTED' box is gone", !/TOTAL COLLECTED/.test(t));
  await shot(c, "6-reports");

  await clickText(c, "Din ka Hisaab (PDF jaisa)", { exact: false });
  await waitFor(c, "!!document.querySelector('.hisaab-overlay')", "Hisaab Report open");
  await sleep(1000);
  t = await text(c);
  check("day report: GAMING, CANTEEN and Kul galla sections", /1\) GAMING/.test(t) && /2\) CANTEEN/.test(t) && /3\) Kul galla/.test(t) && /4\).*ka credit/.test(t));
  const tiles = await c.eval(`document.querySelector(".hisaab-overlay").innerText`);
  check("day report: Gaming Cash 160, Canteen Account 40", /Cash aaya\s*₹160/.test(tiles) && /Account aaya\s*₹40/.test(tiles), tiles.slice(0, 700));
  check("day report: total galla Cash 260, Account 40", /TOTAL galla\s*260\s*40\s*300/.test(tiles.replace(/₹/g, "")), tiles.replace(/₹/g, "").slice(600, 1500));
  await shot(c, "7-day-report");
  await clickText(c, "Excel", { exact: true, tag: "button" });
  await sleep(3000);
  const dayX = path.join(H.DL, `Din-Hisaab-${today}.xlsx`);
  const XLSX = require(path.join(__dirname, "..", "node_modules", "xlsx"));
  check("day Excel downloaded", fs.existsSync(dayX));
  if (fs.existsSync(dayX)) {
    const wb = XLSX.readFile(dayX);
    const names = wb.SheetNames;
    check("day Excel sheets: Gaming, Canteen, Credit, Milaan", ["Din ka hisaab", "Gaming (table-wise)", "Canteen (category-wise)", "Credit (Gaming-Canteen)", "Milaan (accountant)"].every((n) => names.includes(n)), names.join(" | "));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Din ka hisaab"]);
    const total = rows.find((r) => r.Cheez === "TOTAL galla");
    check("day Excel: TOTAL galla Cash 260 / Account 40", !!total && total.Cash === 260 && total.Account === 40, JSON.stringify(total));
    const g = XLSX.utils.sheet_to_json(wb.Sheets["Gaming (table-wise)"]);
    check("day Excel: Gaming TOTAL row cash 160, no credit", g[g.length - 1]["Cash aaya"] === 160 && g[g.length - 1]["Credit diya"] === 0, JSON.stringify(g[g.length - 1]));
  }
  await clickText(c, "Mahine ka hisaab", { exact: true, tag: "button" });
  await sleep(1500);
  t = await text(c);
  check("month view: Gaming, Canteen, galla and day-by-day table", /1\) GAMING/.test(t) && /2\) CANTEEN/.test(t) && /Din ke hisaab se/.test(t) && /Gaming Cash/.test(t));
  await shot(c, "8-month-report");
  await clickText(c, "Excel", { exact: true, tag: "button" });
  await sleep(3000);
  const monthX = path.join(H.DL, `Mahine-Ka-Hisaab-${today.slice(0, 7)}.xlsx`);
  check("month Excel downloaded", fs.existsSync(monthX));
  if (fs.existsSync(monthX)) {
    const wb = XLSX.readFile(monthX);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const days = rows.filter((r) => r.Din !== "TOTAL");
    const tot = rows.find((r) => r.Din === "TOTAL");
    const sum = (k) => Math.round(days.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100;
    check("month Excel: TOTAL row equals the sum of the days (Gaming Cash, Canteen Account, Credit)", tot["Gaming Cash"] === sum("Gaming Cash") && tot["Canteen Account"] === sum("Canteen Account") && tot["Canteen Credit diya"] === sum("Canteen Credit diya"), JSON.stringify(tot));
    const last = days[days.length - 1];
    check("month Excel: today's row has Gaming Cash 160 and Canteen Credit 130", last["Gaming Cash"] === 160 && last["Canteen Credit diya"] === 130, JSON.stringify(last));
  }
  await clickText(c, "Customer-wise mahina", { exact: true, tag: "button" });
  await sleep(1500);
  t = await text(c);
  check("customer-wise month: shows Gaming / Canteen split of the credit taken", /Isme Gaming/.test(t) && /Isme Canteen/.test(t) && /Test Regular/.test(t), t.slice(0, 500));
  await clickText(c, "Credit baaki (sab din)", { exact: true, tag: "button" });
  await sleep(2000);
  t = await text(c);
  check("credit tab still works: Kiska credit baaki hai", /Kiska credit baaki hai/.test(t) && /Test Regular/.test(t));
  await c.eval(`document.querySelector(".hisaab-overlay button[aria-label=Close]")?.click()`);

  // ---------- 6. split bill: two people, table + food each ----------
  console.log("\n== 6. Split bill ==");
  await go(c, "/", PIN);
  await waitFor(c, "document.body.innerText.includes('Split A')", "split bill on Home");
  await sleep(500);
  await clickText(c, "Split A", { tag: "p" });
  await waitFor(c, "document.body.innerText.includes('Split bill')", "split checkout open");
  await sleep(400);
  await clickText(c, "Customer Bill (customer ko dikhao)", { exact: false });
  await sleep(500);
  t = await text(c);
  check("split bill: Customer Bill shows Gaming 100 and Canteen 40 and each payer's share", /Gaming total\s*₹100/.test(t) && /Canteen total\s*₹40/.test(t) && /Split A · Table charge/.test(t) && /Kul bill\s*₹140/.test(t), t.slice(-500));
  await c.eval(`document.querySelector(".print-slip button[aria-label=Close]")?.click()`);
  await sleep(300);
  await clickText(c, "Cash", { exact: true, tag: "button" }); // Split A, table charge 50
  await sleep(400);
  await clickText(c, "Credit", { exact: true, tag: "button" }); // Split A, food 20 - A is not a regular
  await sleep(400);
  t = await text(c);
  check("split bill: credit for a one-time payer is stopped with a message", /Split A\s+regular customer nahi hai/.test(t), t.slice(0, 600));
  await clickText(c, "Theek hai", { exact: true, tag: "button" });
  await sleep(300);
  await clickText(c, "Cash", { exact: true, tag: "button" }); // Split A, food 20 in cash
  await sleep(400);
  await clickText(c, "Credit", { exact: true, tag: "button" }); // Split B, table 50 - not a regular yet
  await sleep(400);
  await clickText(c, "Regular banao + credit do", { exact: true, tag: "button" });
  await sleep(500);
  await clickText(c, "Credit", { exact: true, tag: "button" }); // Split B, food 20 - now a regular
  await sleep(600);
  t = await text(c);
  check("split bill: all four shares settled", /All shares settled/.test(t), t.slice(0, 500));
  const b4 = await billOf(c, B4.id);
  const how = (b4.shares || []).map((x) => x.payerName + "/" + x.label + "/" + x.paymentMethod).join(", ");
  check("split bill saved: A paid cash for table and food, B put both on credit", how === "Split A/Table charge/cash, Split B/Table charge/credit, Split A/Food/cash, Split B/Food/credit" && b4.status === "paid", how + " " + b4.status);
  const regs = await c.eval(`(() => { const cs = ${stateOf("cuebill-customers")}.customers; const f = (n) => cs.find((x) => x.name === n); return { a: f("Split A") ? !!f("Split A").isRegular : null, b: f("Split B") ? !!f("Split B").isRegular : null }; })()`);
  check("split bill: Split B became a regular, Split A did not", regs.b === true && regs.a !== true, JSON.stringify(regs));
  await clickText(c, "Done", { exact: true, tag: "button" });
  await go(c, "/credits", PIN);
  await H.typeInto(c, 'input[placeholder="Search name, phone"]', "Split B");
  await sleep(500);
  const card3 = await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "Split B"); return p ? p.closest("[class*=border]").innerText : null; })()`);
  check("Credits page: Split B owes 70 = Gaming 50 + Canteen 20", !!card3 && /Gaming\s*₹50/.test(card3) && /Canteen\s*₹20/.test(card3), String(card3));
  await go(c, "/reports", PIN);
  const box2 = (await c.eval(`(() => { const p = [...document.querySelectorAll("p")].find((x) => x.textContent.trim() === "AAJ"); return p ? p.parentElement.innerText : null; })()`) || "").replace(/₹/g, "");
  // before: Gaming cash 160 | Canteen cash 100, account 40, credit 130.  Split adds: Gaming cash 50, credit 50 | Canteen cash 20, credit 20
  check("Reports: today now Gaming cash 210 / credit 50, Canteen cash 120 / account 40 / credit 150, total cash 330 / credit 200", /Gaming\s+210\s+-?\s*50/.test(box2.replace(/\s+-\s+/g, " - ")) && /Canteen\s+120\s+40\s+150/.test(box2) && /Kul\s+330\s+40\s+200/.test(box2), box2);

  // ---------- 7. nothing lost after a hard kill ----------
  console.log("\n== 7. After the app is killed ==");
  await sleep(900);
  c.close();
  H.hardKill();
  await sleep(1500);
  H.launch();
  c = await H.connect();
  await unlock(c, PIN);
  b1 = await billOf(c, B1.id);
  check("the bill's Gaming / Canteen split is still there after a restart", !!b1.parts && b1.parts.canteen.upi === 40 && b1.parts.canteen.due === 50);
  check("no page errors in the whole run", c.errors.length === 0, c.errors.slice(0, 3).join(" | "));
  const outside = c.requests.filter((u) => !/^(app|data|blob|devtools):/.test(u));
  check("nothing went outside the app", outside.length === 0, outside.join(", "));
  c.close();
  H.hardKill();

  console.log(H.failures() === 0 ? "\nALL BILLING CHECKS PASSED" : `\n${H.failures()} CHECK(S) FAILED`);
  console.log("Screenshots and downloads:", work);
  process.exit(H.failures() === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  H.hardKill();
  process.exit(2);
});
