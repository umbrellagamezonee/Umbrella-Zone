// Pulls the shop's data from Supabase (read-only GET requests) into ./data
const fs = require("fs");
const path = require("path");
const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const url = get("VITE_SUPABASE_URL");
const key = get("VITE_SUPABASE_ANON_KEY");
if (!url || !key) throw new Error(".env.local mein VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY nahi mila");

async function fetchAll(table) {
  const pageSize = 1000;
  let from = 0;
  let out = [];
  while (true) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&order=id&offset=${from}&limit=${pageSize}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`${table} fetch failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    out = out.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

(async () => {
  const dir = path.join(__dirname, "data");
  fs.mkdirSync(dir, { recursive: true });
  const tables = { expenses: "final_expenses", bills: "final_bills", canteen_orders: "final_orders", menu_items: "final_menuitems", menu_categories: "final_menucats", billing_tables: "final_tables", customers: "final_customers" };
  for (const [table, file] of Object.entries(tables)) {
    const rows = await fetchAll(table);
    fs.writeFileSync(path.join(dir, file + ".json"), JSON.stringify(rows));
    console.log(table, rows.length);
  }
})();
