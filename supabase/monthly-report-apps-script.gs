/**
 * CueBill — Monthly Paid Bills Report + Live Stock & Profit Report
 *
 * SETUP (one time):
 *  1. Open (or create) a Google Sheet.
 *  2. Extensions → Apps Script.
 *  3. Delete whatever is in the editor, paste this whole file.
 *  4. Save (the disk icon / Ctrl+S).
 *  5. In the toolbar dropdown next to "Debug", pick `setupMonthlyTrigger`,
 *     then click ▶ Run once — approve the authorization prompt. Repeat for
 *     `setupStockProfitTrigger`. (Two separate one-time runs, two separate
 *     triggers — only needed once each, ever.)
 *  6. Done:
 *     - On the 1st of every month at 6 AM IST, a new tab appears with last
 *       month's paid bills, totalled at the bottom.
 *     - A "Stock & Profit" tab refreshes every hour, and also the moment
 *       anyone opens this spreadsheet — always showing current cost price,
 *       profit, units sold, and pending stock per item.
 *
 * To test right now instead of waiting: run `generateMonthlyReport` or
 * `updateStockProfitReport` directly (pick it in the dropdown, click ▶ Run).
 *
 * Note: Cost Price / Profit columns only fill in once the "cost_price"
 * column exists on the live Supabase "menu_items" table (see
 * supabase/migration-all-pending.sql) — until then they show "Not set",
 * same as in the app's own Excel export.
 */

// Same public URL + anon key already used by the live CueBill site — these
// are meant to be public (same ones baked into the deployed app's JS), and
// this project's Row Level Security allows read access with them.
const SUPABASE_URL = "https://qugznkzzzuklxvbqeqzw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Tbl9LTaV-TujWqH3tkpHqg_HHI_soNg";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30, no DST

// Runs automatically via the trigger set up below. Also safe to run by hand
// any time to test — it always reports the PREVIOUS full calendar month
// (IST), so running it mid-month for testing still shows real data.
function generateMonthlyReport() {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth(); // 0-based; this month, so "previous" is month-1

  // First moment of last month and first moment of this month, both in IST,
  // converted back to real UTC instants for the Supabase query.
  const startIst = Date.UTC(year, month - 1, 1, 0, 0, 0);
  const endIst = Date.UTC(year, month, 1, 0, 0, 0);
  const startUtc = new Date(startIst - IST_OFFSET_MS).toISOString();
  const endUtc = new Date(endIst - IST_OFFSET_MS).toISOString();
  const monthLabel = Utilities.formatDate(new Date(startIst), "UTC", "MMM yyyy");

  const bills = fetchSupabase(
    "bills",
    "select=*&created_at=gte." + encodeURIComponent(startUtc) +
      "&created_at=lt." + encodeURIComponent(endUtc) +
      "&amount_paid=gt.0&order=created_at.asc"
  );

  const customers = fetchSupabase("customers", "select=id,name");
  const nameById = {};
  customers.forEach(function (c) { nameById[c.id] = c.name; });

  const rows = [
    ["Date", "Time", "Table / Place", "Customer", "Total", "Amount Paid", "On Credit", "Payment Method"],
  ];
  let sumTotal = 0, sumPaid = 0, sumCredit = 0;
  bills.forEach(function (b) {
    const ist = new Date(new Date(b.created_at).getTime() + IST_OFFSET_MS);
    const total = Number(b.total);
    const paid = Number(b.amount_paid);
    const credit = Number(b.amount_due);
    sumTotal += total;
    sumPaid += paid;
    sumCredit += credit;
    rows.push([
      Utilities.formatDate(ist, "UTC", "dd MMM yyyy"),
      Utilities.formatDate(ist, "UTC", "hh:mm a"),
      b.table_name || "Canteen",
      nameById[b.customer_id] || "Walk-in",
      total,
      paid,
      credit,
      b.payment_method || "",
    ]);
  });
  rows.push(["", "", "", "TOTAL", sumTotal, sumPaid, sumCredit, ""]);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheetName = monthLabel;
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) ss.deleteSheet(sheet); // re-running (e.g. a manual test) replaces it cleanly
  sheet = ss.insertSheet(sheetName);
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(1, 1, 1, rows[0].length).setFontWeight("bold");
  sheet.getRange(rows.length, 1, 1, rows[0].length).setFontWeight("bold"); // TOTAL row
  sheet.autoResizeColumns(1, rows[0].length);
}

// Run this once from the Apps Script editor to schedule the monthly run —
// see the setup steps at the top of this file.
function setupMonthlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "generateMonthlyReport") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("generateMonthlyReport")
    .timeBased()
    .onMonthDay(1)
    .atHour(6)
    .create();
}

// Live "what do we have, what did it cost, what did it make" snapshot —
// unlike the monthly report, this has no date range: it's always the
// current state of every menu item. Re-running replaces the sheet in
// place (same tab every time) rather than adding a new one.
function updateStockProfitReport() {
  const items = fetchSupabase("menu_items", "select=*");
  const categories = fetchSupabase("menu_categories", "select=id,name");
  const bills = fetchSupabase("bills", "select=canteen_items&status=neq.cancelled");

  const categoryNameById = {};
  categories.forEach(function (c) { categoryNameById[c.id] = c.name; });

  // Real sales per item name, cancelled bills excluded — matches the app's
  // own Excel export so the two always agree.
  const soldByName = {};
  bills.forEach(function (b) {
    (b.canteen_items || []).forEach(function (line) {
      const entry = soldByName[line.name] || { qty: 0, revenue: 0 };
      entry.qty += line.qty;
      entry.revenue += line.price * line.qty;
      soldByName[line.name] = entry;
    });
  });

  const rows = [[
    "Item", "Category", "Selling Price", "Cost Price", "Profit / Unit",
    "Qty Sold", "Qty In Stock (Pending)", "Revenue", "Total Cost", "Total Profit",
  ]];
  let totalQty = 0, totalRevenue = 0, totalCost = 0, totalProfit = 0;
  const seenNames = {};

  items.forEach(function (i) {
    seenNames[i.name] = true;
    const sold = soldByName[i.name] || { qty: 0, revenue: 0 };
    const hasCost = i.cost_price !== null && i.cost_price !== undefined;
    const cost = hasCost ? Number(i.cost_price) : null;
    const cogs = hasCost ? cost * sold.qty : null;
    const profit = hasCost ? sold.revenue - cogs : null;
    totalQty += sold.qty;
    totalRevenue += sold.revenue;
    if (hasCost) {
      totalCost += cogs;
      totalProfit += profit;
    }
    rows.push([
      i.name,
      categoryNameById[i.category_id] || "",
      Number(i.price),
      hasCost ? cost : "Not set",
      hasCost ? Number(i.price) - cost : "",
      sold.qty,
      i.stock_qty === null || i.stock_qty === undefined ? "Not tracked" : i.stock_qty,
      sold.revenue,
      hasCost ? cogs : "",
      hasCost ? profit : "",
    ]);
  });

  // Sold under a name no longer in the current menu (renamed/deleted item)
  // — kept so totals still match the app's Canteen Items sheet exactly.
  Object.keys(soldByName).forEach(function (name) {
    if (seenNames[name]) return;
    const sold = soldByName[name];
    totalQty += sold.qty;
    totalRevenue += sold.revenue;
    rows.push([name, "(removed from menu)", "", "", "", sold.qty, "", sold.revenue, "", ""]);
  });

  rows.push(["TOTAL", "", "", "", "", totalQty, "", totalRevenue, totalCost, totalProfit]);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = "Stock & Profit";
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(1, 1, 1, rows[0].length).setFontWeight("bold");
  sheet.getRange(rows.length, 1, 1, rows[0].length).setFontWeight("bold"); // TOTAL row
  sheet.autoResizeColumns(1, rows[0].length);

  const stamp = "Last updated " + Utilities.formatDate(new Date(), "Asia/Kolkata", "dd MMM yyyy, hh:mm a") + " IST";
  sheet.getRange(rows.length + 2, 1).setValue(stamp);
}

// Run this once from the Apps Script editor to keep Stock & Profit fresh —
// see the setup steps at the top of this file. Refreshes hourly, and also
// immediately whenever this spreadsheet is opened (see onOpen below).
function setupStockProfitTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "updateStockProfitReport") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("updateStockProfitReport")
    .timeBased()
    .everyHours(1)
    .create();
  updateStockProfitReport(); // fills the tab in immediately instead of waiting an hour
}

// Google calls this automatically whenever a person opens this spreadsheet
// in the Sheets UI — keeps Stock & Profit current without waiting for the
// next hourly run.
function onOpen() {
  updateStockProfitReport();
}

function fetchSupabase(table, query) {
  const url = SUPABASE_URL + "/rest/v1/" + table + "?" + query;
  const res = UrlFetchApp.fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
    },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    throw new Error("Supabase request failed: " + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}
