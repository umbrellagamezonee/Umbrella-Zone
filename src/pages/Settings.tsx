import { useState } from "react";
import type { MenuItem } from "../types";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { AdminPinGate } from "../components/AdminPinGate";
import { useTablesStore, orderedTables } from "../store/useTablesStore";
import { useMenuStore } from "../store/useMenuStore";
import { useGamesStore } from "../store/useGamesStore";
import { useBillsStore } from "../store/useBillsStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useExpensesStore } from "../store/useExpensesStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { markRestoreInProgress } from "../lib/cloudSync";
import { formatMoney, formatDateTime, IST_TIME_ZONE } from "../lib/format";
import { creditBalanceFor, dailyCollectionRows, categoryStockProfit, creditSettlementDetails } from "../lib/billing";
import { normalizeName } from "../lib/customerName";
import {
  LayoutGrid,
  Tag,
  UtensilsCrossed,
  Store,
  Users,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Gamepad2,
  RotateCcw,
  Download,
  Palette,
  Check,
  Moon,
  Sun,
  AlertTriangle,
  FileSpreadsheet,
  Search,
} from "lucide-react";

type Panel =
  | "tables"
  | "rates"
  | "games"
  | "menu"
  | "store"
  | "trash"
  | "backup"
  | "export"
  | "theme"
  | "danger"
  | null;

const THEME_PRESETS: { name: string; hex: string }[] = [
  { name: "Purple", hex: "#8b5cf6" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Teal", hex: "#14b8a6" },
  { name: "Green", hex: "#22c55e" },
  { name: "Orange", hex: "#f97316" },
  { name: "Red", hex: "#ef4444" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Indigo", hex: "#6366f1" },
];

export function Settings() {
  const [panel, setPanel] = useState<Panel>(null);
  const deletedCount = useBillsStore((s) => s.deletedBills.length);

  const rows: { key: Panel; icon: typeof LayoutGrid; title: string; desc: string }[] = [
    { key: "tables", icon: LayoutGrid, title: "Table Management", desc: "Add and configure billing tables" },
    { key: "rates", icon: Tag, title: "Table Rate & Rules", desc: "Default hourly pricing per table" },
    { key: "games", icon: Gamepad2, title: "Games & Rates", desc: "Per-game rates used at check-in" },
    { key: "menu", icon: UtensilsCrossed, title: "Menu Management", desc: "Items, categories, and inventory" },
    { key: "store", icon: Store, title: "Store Settings", desc: "Currency symbol and store name" },
    {
      key: "trash",
      icon: Trash2,
      title: "Deleted Bills",
      desc: deletedCount > 0 ? `${deletedCount} waiting — restore or delete for good` : "Restore or permanently remove",
    },
    {
      key: "backup",
      icon: Download,
      title: "Backup & Restore",
      desc: "Save all your data to a file, or restore from one",
    },
    {
      key: "export",
      icon: FileSpreadsheet,
      title: "Export Data (Excel)",
      desc: "Download everything as a spreadsheet to open and check",
    },
    {
      key: "theme",
      icon: Palette,
      title: "Theme",
      desc: "Pick the app's color",
    },
  ];

  return (
    <AppShell title="Settings">
      <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)]">SETUP</p>
      <div className="space-y-2">
        {rows.map((row) => (
          <Card key={row.key} onClick={() => setPanel(row.key)} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-[var(--color-surface-2)] flex items-center justify-center text-[var(--color-primary)]">
                <row.icon size={18} />
              </div>
              <div>
                <p className="text-sm font-medium">{row.title}</p>
                <p className="text-xs text-[var(--color-text-dim)]">{row.desc}</p>
              </div>
            </div>
            <ChevronRight size={16} className="text-[var(--color-text-faint)]" />
          </Card>
        ))}

        <Card className="flex items-center justify-between opacity-60">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[var(--color-surface-2)] flex items-center justify-center text-[var(--color-primary)]">
              <Users size={18} />
            </div>
            <div>
              <p className="text-sm font-medium">Staff & Roles</p>
              <p className="text-xs text-[var(--color-text-dim)]">Coming soon</p>
            </div>
          </div>
        </Card>
      </div>

      <p className="text-xs font-semibold tracking-wide text-[var(--color-danger)] pt-2">DANGER ZONE</p>
      <Card
        onClick={() => setPanel("danger")}
        className="flex items-center justify-between border-[var(--color-danger)]/30"
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-[var(--color-danger)]/10 flex items-center justify-center text-[var(--color-danger)]">
            <AlertTriangle size={18} />
          </div>
          <div>
            <p className="text-sm font-medium">Reset Data</p>
            <p className="text-xs text-[var(--color-text-dim)]">
              Erase bills, customers, orders and expenses — menu is kept
            </p>
          </div>
        </div>
        <ChevronRight size={16} className="text-[var(--color-text-faint)]" />
      </Card>

      {panel === "tables" && <TableManagementModal onClose={() => setPanel(null)} />}
      {panel === "rates" && <TableRatesModal onClose={() => setPanel(null)} />}
      {panel === "games" && <GamesRatesModal onClose={() => setPanel(null)} />}
      {panel === "menu" && (
        <AdminPinGate title="Menu Management" onClose={() => setPanel(null)}>
          <MenuManagementModal onClose={() => setPanel(null)} />
        </AdminPinGate>
      )}
      {panel === "store" && <StoreSettingsModal onClose={() => setPanel(null)} />}
      {panel === "trash" && (
        <AdminPinGate title="Deleted Bills" onClose={() => setPanel(null)}>
          <DeletedBillsModal onClose={() => setPanel(null)} />
        </AdminPinGate>
      )}
      {panel === "backup" && (
        <AdminPinGate title="Backup & Restore" onClose={() => setPanel(null)}>
          <BackupModal onClose={() => setPanel(null)} />
        </AdminPinGate>
      )}
      {panel === "export" && <ExportExcelModal onClose={() => setPanel(null)} />}
      {panel === "theme" && <ThemeModal onClose={() => setPanel(null)} />}
      {panel === "danger" && (
        <AdminPinGate title="Reset Data" onClose={() => setPanel(null)}>
          <ResetAllDataModal onClose={() => setPanel(null)} />
        </AdminPinGate>
      )}
    </AppShell>
  );
}

function TableManagementModal({ onClose }: { onClose: () => void }) {
  const tables = useTablesStore((s) => s.tables);
  const addTable = useTablesStore((s) => s.addTable);
  const updateTable = useTablesStore((s) => s.updateTable);
  const removeTable = useTablesStore((s) => s.removeTable);
  const moveTable = useTablesStore((s) => s.moveTable);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("PlayStation");
  const [rate, setRate] = useState("60");

  const ordered = orderedTables(tables);

  function handleAdd() {
    if (!name.trim()) return;
    addTable({ name: name.trim(), kind, ratePerHour: Math.max(0, Number(rate) || 0), note: "" });
    setName("");
  }

  return (
    <Modal title="Table Management" onClose={onClose}>
      <p className="text-xs text-[var(--color-text-dim)] mb-2">
        Use the arrows to set the order tables appear in — on this screen and on Home.
      </p>
      <div className="space-y-2 mb-4">
        {ordered.map((t, i) => (
          <Card key={t.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <input
                value={t.name}
                onChange={(e) => updateTable(t.id, { name: e.target.value })}
                className="w-full bg-transparent text-sm font-medium outline-none rounded px-1 -mx-1 focus:bg-[var(--color-surface-2)]"
              />
              <p className="text-xs text-[var(--color-text-dim)]">{t.kind}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => moveTable(t.id, "up")}
                disabled={i === 0}
                aria-label="Move up"
                className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-dim)] disabled:opacity-25"
              >
                <ChevronUp size={15} />
              </button>
              <button
                onClick={() => moveTable(t.id, "down")}
                disabled={i === ordered.length - 1}
                aria-label="Move down"
                className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-dim)] disabled:opacity-25"
              >
                <ChevronDown size={15} />
              </button>
              <button
                onClick={() => setConfirmDeleteId(t.id)}
                disabled={t.status !== "available"}
                aria-label="Delete table"
                className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)] disabled:opacity-30"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </Card>
        ))}
      </div>

      <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">ADD TABLE</p>
      <div className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Table name (e.g. Pool 1)"
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
        />
        <div className="flex gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="flex-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          >
            <option>PlayStation</option>
            <option>Pool</option>
            <option>Snooker</option>
            <option>PC</option>
            <option>Other</option>
          </select>
          <input
            type="number"
            min={0}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="Rate/hr"
            className="w-28 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <button
          onClick={handleAdd}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] text-white font-semibold py-2.5"
        >
          <Plus size={16} /> Add table
        </button>
      </div>

      {confirmDeleteId && (
        <AdminPinGate
          title="Delete table"
          onClose={() => setConfirmDeleteId(null)}
          onConfirm={() => removeTable(confirmDeleteId)}
        />
      )}
    </Modal>
  );
}

function TableRatesModal({ onClose }: { onClose: () => void }) {
  const tables = useTablesStore((s) => s.tables);
  const updateTable = useTablesStore((s) => s.updateTable);
  const currency = useSettingsStore((s) => s.currencySymbol);

  return (
    <Modal title="Table Rate & Rules" onClose={onClose}>
      <div className="space-y-2">
        {tables.map((t) => (
          <Card key={t.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-[var(--color-text-dim)]">{t.kind}</p>
              </div>
              <div className="flex items-center gap-1 text-sm">
                <span className="text-[var(--color-text-dim)]">{currency}</span>
                <input
                  type="number"
                  min={0}
                  value={t.ratePerHour}
                  onChange={(e) => updateTable(t.id, { ratePerHour: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-16 bg-[var(--color-surface-2)] rounded-lg px-2 py-1 outline-none text-right"
                />
                <span className="text-[var(--color-text-dim)]">/hr</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--color-border)]">
              <span className="text-xs text-[var(--color-text-dim)]">Default session length</span>
              <div className="flex items-center gap-1 text-sm">
                <input
                  type="number"
                  min={1}
                  value={t.defaultSessionMinutes}
                  onChange={(e) =>
                    updateTable(t.id, { defaultSessionMinutes: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="w-16 bg-[var(--color-surface-2)] rounded-lg px-2 py-1 outline-none text-right"
                />
                <span className="text-[var(--color-text-dim)]">min</span>
              </div>
            </div>
          </Card>
        ))}
        <p className="text-xs text-[var(--color-text-faint)] pt-2">
          A running session auto-tracks against this default length. Billing always uses the
          actual time played — happy-hour and scheduled pricing rules are coming soon.
        </p>
      </div>
    </Modal>
  );
}

function GamesRatesModal({ onClose }: { onClose: () => void }) {
  const games = useGamesStore((s) => s.games);
  const addGame = useGamesStore((s) => s.addGame);
  const updateGame = useGamesStore((s) => s.updateGame);
  const removeGame = useGamesStore((s) => s.removeGame);
  const tables = useTablesStore((s) => s.tables);
  const currency = useSettingsStore((s) => s.currencySymbol);

  const kinds = Array.from(new Set(tables.map((t) => t.kind)));

  const [name, setName] = useState("");
  const [kind, setKind] = useState(kinds[0] ?? "PlayStation");
  const [rate, setRate] = useState("");

  function handleAdd() {
    if (!name.trim()) return;
    addGame({ name: name.trim(), kind, ratePerHour: Math.max(0, Number(rate) || 0) });
    setName("");
    setRate("");
  }

  return (
    <Modal title="Games & Rates" onClose={onClose}>
      <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
        {games.map((g) => (
          <Card key={g.id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{g.name}</p>
              <p className="text-xs text-[var(--color-text-dim)]">{g.kind}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-sm">
                <span className="text-[var(--color-text-dim)]">{currency}</span>
                <input
                  type="number"
                  min={0}
                  value={g.ratePerHour}
                  onChange={(e) => updateGame(g.id, { ratePerHour: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-16 bg-[var(--color-surface-2)] rounded-lg px-2 py-1 outline-none text-right"
                />
                <span className="text-[var(--color-text-dim)]">/hr</span>
              </div>
              <button
                onClick={() => removeGame(g.id)}
                disabled={tables.some((t) => t.activeGameId === g.id)}
                title={tables.some((t) => t.activeGameId === g.id) ? "In use on an active table" : undefined}
                className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)] disabled:opacity-30"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </Card>
        ))}
        {games.length === 0 && (
          <p className="text-sm text-[var(--color-text-faint)] text-center py-4">
            No games yet — add one below.
          </p>
        )}
      </div>

      <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">ADD GAME</p>
      <div className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Game name (e.g. FIFA 24)"
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
        />
        <div className="flex gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="flex-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          >
            {kinds.length === 0 && <option value="PlayStation">PlayStation</option>}
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="Rate/hr"
            className="w-28 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <button
          onClick={handleAdd}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] text-white font-semibold py-2.5"
        >
          <Plus size={16} /> Add game
        </button>
      </div>
      <p className="text-xs text-[var(--color-text-faint)] pt-3">
        Games shown here appear in the "+" check-in form on Home, matched by table type.
      </p>
    </Modal>
  );
}

function MenuManagementModal({ onClose }: { onClose: () => void }) {
  const items = useMenuStore((s) => s.items);
  const categories = useMenuStore((s) => s.categories);
  const addItem = useMenuStore((s) => s.addItem);
  const updateItem = useMenuStore((s) => s.updateItem);
  const removeItem = useMenuStore((s) => s.removeItem);
  const currency = useSettingsStore((s) => s.currencySymbol);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [stock, setStock] = useState("");
  const [categoryId, setCategoryId] = useState(
    categories.find((c) => c.name === "Kitchen")?.id ?? categories[0]?.id ?? ""
  );
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number } | null>(null);
  const [importError, setImportError] = useState("");
  const [search, setSearch] = useState("");

  const filteredItems = items.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()));

  function handleAddItem() {
    if (!name.trim() || !categoryId) return;
    addItem({
      name: name.trim(),
      price: Math.max(0, Number(price) || 0),
      costPrice: costPrice.trim() === "" ? null : Math.max(0, Number(costPrice) || 0),
      categoryId,
      inStock: true,
      stockQty: stock.trim() === "" ? null : Math.max(0, Number(stock) || 0),
      lowStockThreshold: 5,
    });
    setName("");
    setPrice("");
    setCostPrice("");
    setStock("");
  }

  // Looks up a value by trying several possible header spellings — sheets
  // people already have rarely use this app's exact field names.
  function pickColumn(row: Record<string, unknown>, keys: string[]): string | undefined {
    const normalized = new Map(Object.keys(row).map((k) => [k.trim().toLowerCase(), k]));
    for (const key of keys) {
      const realKey = normalized.get(key);
      if (realKey !== undefined && row[realKey] !== undefined && row[realKey] !== "") {
        return String(row[realKey]);
      }
    }
    return undefined;
  }

  function categoryIdForName(rawCategory: string | undefined): string {
    if (rawCategory) {
      const match = categories.find((c) => c.name.toLowerCase() === rawCategory.trim().toLowerCase());
      if (match) return match.id;
    }
    // No category given (or it didn't match one of the three) — Kitchen,
    // not just whichever category happens to be first in the array (cloud
    // fetch order isn't guaranteed to put Kitchen first).
    return categories.find((c) => c.name === "Kitchen")?.id ?? categories[0]?.id ?? "";
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again later
    if (!file) return;
    setImportError("");
    setImportResult(null);
    setImporting(true);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      let added = 0;
      let skipped = 0;
      for (const row of rows) {
        const rawName = pickColumn(row, ["name", "item", "item name", "product", "item name/naam"]);
        const rawPrice = pickColumn(row, ["price", "selling price", "rate", "mrp"]);
        const rawStock = pickColumn(row, ["stock", "qty", "quantity", "stock qty", "in stock"]);
        const rawCost = pickColumn(row, ["cost", "cost price", "buy price", "purchase price"]);
        const rawCategory = pickColumn(row, ["category"]);

        if (!rawName?.trim()) {
          skipped++;
          continue;
        }
        addItem({
          name: rawName.trim(),
          price: Math.max(0, Number(rawPrice) || 0),
          costPrice: rawCost === undefined ? null : Math.max(0, Number(rawCost) || 0),
          categoryId: categoryIdForName(rawCategory),
          inStock: true,
          stockQty: rawStock === undefined ? null : Math.max(0, Number(rawStock) || 0),
          lowStockThreshold: 5,
        });
        added++;
      }
      setImportResult({ added, skipped });
    } catch {
      setImportError("Couldn't read that file — try an Excel (.xlsx) or CSV file, with column names in the first row (Name, Price, Stock).");
    } finally {
      setImporting(false);
    }
  }


  return (
    <Modal title="Menu Management" onClose={onClose}>
      <div className="relative mb-3">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items..."
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"
        />
      </div>
      <p className="text-xs text-[var(--color-text-faint)] mb-3">
        Stock goes down on its own as items sell. It never goes back up by
        itself — after you buy new stock, come back here and type the new
        total for that item.
      </p>
      <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
        {filteredItems.length === 0 && (
          <p className="text-sm text-[var(--color-text-faint)] text-center py-4">
            No items match "{search}".
          </p>
        )}
        {filteredItems.map((item) => {
          const cat = categories.find((c) => c.id === item.categoryId);
          const low = item.stockQty != null && item.stockQty <= item.lowStockThreshold;
          const margin = item.costPrice != null ? item.price - item.costPrice : null;
          return (
            <Card key={item.id}>
              <div className="flex items-center justify-between gap-2">
                <input
                  value={item.name}
                  onChange={(e) => updateItem(item.id, { name: e.target.value })}
                  className="flex-1 min-w-0 bg-transparent text-sm font-medium outline-none rounded px-1 -mx-1 focus:bg-[var(--color-surface-2)]"
                />
                <button
                  onClick={() => removeItem(item.id)}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)] shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {(cat || margin != null) && (
                <p className="text-xs text-[var(--color-text-dim)] mt-0.5">
                  {cat?.name}
                  {margin != null && (
                    <span className="text-[var(--color-success)]"> · +{formatMoney(margin, currency)} margin</span>
                  )}
                </p>
              )}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--color-border)]">
                <span className="text-xs text-[var(--color-text-dim)]">Price</span>
                <input
                  type="number"
                  min={0}
                  value={item.price}
                  onChange={(e) => updateItem(item.id, { price: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-16 bg-[var(--color-surface-2)] rounded-lg px-2 py-1 text-sm outline-none text-right"
                />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs text-[var(--color-text-dim)]">Category</span>
                <select
                  value={item.categoryId}
                  onChange={(e) => updateItem(item.id, { categoryId: e.target.value })}
                  className="bg-[var(--color-surface-2)] rounded-lg px-2 py-1 text-sm outline-none"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs text-[var(--color-text-dim)]">Cost price</span>
                <input
                  type="number"
                  min={0}
                  value={item.costPrice ?? ""}
                  placeholder="—"
                  onChange={(e) =>
                    updateItem(item.id, {
                      costPrice: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-16 bg-[var(--color-surface-2)] rounded-lg px-2 py-1 text-sm outline-none text-right"
                />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className={"text-xs " + (low ? "text-[var(--color-danger)] font-medium" : "text-[var(--color-text-dim)]")}>
                  {item.stockQty == null
                    ? "Stock not tracked"
                    : item.stockQty === 0
                    ? "Out of stock — got new stock? Update the number →"
                    : `${item.stockQty} in stock${low ? " · running low" : ""}`}
                </span>
                <input
                  type="number"
                  min={0}
                  value={item.stockQty ?? ""}
                  placeholder="—"
                  onChange={(e) =>
                    updateItem(item.id, {
                      stockQty: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-16 bg-[var(--color-surface-2)] rounded-lg px-2 py-1 text-sm outline-none text-right"
                />
              </div>
            </Card>
          );
        })}
      </div>

      <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
        IMPORT FROM EXCEL
      </p>
      <div className="mb-4">
        <label className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-medium py-2.5 cursor-pointer">
          <FileSpreadsheet size={16} />
          {importing ? "Importing…" : "Choose Excel/CSV File"}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={importing}
            onChange={handleImportFile}
          />
        </label>
        <p className="text-xs text-[var(--color-text-faint)] mt-1">
          Pehli row mein column names hone chahiye: Name, Price, Stock — Cost Price aur Category
          (Kitchen/Cigarettes/Fridge) optional hain, na di toh Kitchen mein chala jayega.
        </p>
        {importResult && (
          <p className="text-xs text-[var(--color-success)] mt-1">
            {importResult.added} item{importResult.added === 1 ? "" : "s"} add hue
            {importResult.skipped > 0 ? `, ${importResult.skipped} skip hue (naam missing)` : ""}.
          </p>
        )}
        {importError && <p className="text-xs text-[var(--color-danger)] mt-1">{importError}</p>}
      </div>

      <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">ADD ITEM</p>
      <div className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Item name"
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
        />
        <div className="flex gap-2">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="flex-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            className="w-20 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
            placeholder="Cost price (optional)"
            className="flex-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
          <input
            type="number"
            min={0}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            placeholder="Stock"
            className="w-20 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <button
          onClick={handleAddItem}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] text-white font-semibold py-2.5"
        >
          <Plus size={16} /> Add item
        </button>
      </div>

    </Modal>
  );
}

function StoreSettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettingsStore();
  const [storeName, setStoreName] = useState(settings.storeName);
  const [currencySymbol, setCurrencySymbol] = useState(settings.currencySymbol);
  const [upiId, setUpiId] = useState(settings.upiId);

  function handleSave() {
    settings.update({
      storeName,
      currencySymbol,
      upiId: upiId.trim(),
    });
    onClose();
  }

  return (
    <Modal title="Store Settings" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1.5">
            STORE NAME
          </p>
          <input
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1.5">
            CURRENCY SYMBOL
          </p>
          <input
            value={currencySymbol}
            onChange={(e) => setCurrencySymbol(e.target.value)}
            className="w-24 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1.5">
            UPI ID (for QR payments)
          </p>
          <input
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            placeholder="yourname@upi"
            className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
          <p className="text-xs text-[var(--color-text-faint)] mt-1">
            Used to generate the payment QR shown at checkout.
          </p>
        </div>
        <button
          onClick={handleSave}
          className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

function DeletedBillsModal({ onClose }: { onClose: () => void }) {
  const deletedBills = useBillsStore((s) => s.deletedBills);
  const restoreBill = useBillsStore((s) => s.restoreBill);
  const permanentlyDeleteBill = useBillsStore((s) => s.permanentlyDeleteBill);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const sorted = [...deletedBills].sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  const confirmBill = sorted.find((b) => b.id === confirmId) ?? null;

  return (
    <Modal title="Deleted Bills" onClose={onClose}>
      {sorted.length === 0 ? (
        <p className="text-sm text-[var(--color-text-faint)] text-center py-8">
          Nothing here. Bills you delete from Home show up in this list first.
        </p>
      ) : (
        <div className="space-y-2">
          {sorted.map((bill) => (
            <Card key={bill.id} className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{bill.tableName ?? "Bill"}</p>
                <p className="text-xs text-[var(--color-text-dim)]">
                  {formatMoney(bill.total, currency)}
                  {bill.deletedAt ? ` · deleted ${formatDateTime(bill.deletedAt)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => restoreBill(bill.id)}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-primary)]"
                  title="Restore"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  onClick={() => setConfirmId(bill.id)}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                  title="Delete permanently"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {confirmBill && (
        <Modal title="Delete permanently?" onClose={() => setConfirmId(null)}>
          <p className="text-sm text-[var(--color-text-dim)] mb-4">
            {confirmBill.tableName ?? "This bill"} ·{" "}
            {formatMoney(confirmBill.total, currency)} will be gone for good — this can't be
            undone.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setConfirmId(null)}
              className="rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-medium py-2.5"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                permanentlyDeleteBill(confirmBill.id);
                setConfirmId(null);
              }}
              className="rounded-xl bg-[var(--color-danger)]/15 text-[var(--color-danger)] font-semibold py-2.5"
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function BackupModal({ onClose }: { onClose: () => void }) {
  const adminPin = useSettingsStore((s) => s.adminPin);
  const updateSettings = useSettingsStore((s) => s.update);
  const [pinInput, setPinInput] = useState(adminPin);
  const [pinSaved, setPinSaved] = useState(false);
  const [pending, setPending] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);

  function handleSavePin() {
    if (!pinInput.trim()) return;
    updateSettings({ adminPin: pinInput.trim() });
    setPinSaved(true);
  }

  function handleExport() {
    const backup: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("cuebill")) backup[key] = localStorage.getItem(key) ?? "";
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cuebill-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again later
    if (!file) return;
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as Record<string, string>;
        const keys = Object.keys(data).filter((k) => k.startsWith("cuebill"));
        if (keys.length === 0) throw new Error("empty");
        setPending(data);
      } catch {
        setError("Ye file valid CueBill backup nahi lagti.");
      }
    };
    reader.readAsText(file);
  }

  function handleRestore() {
    if (!pending) return;
    setRestoring(true);
    Object.entries(pending).forEach(([key, value]) => {
      if (key.startsWith("cuebill")) localStorage.setItem(key, value);
    });
    // Otherwise this reload's own cloud fetch treats the cloud as the
    // source of truth and silently overwrites the restored data right back
    // for any record still there — see markRestoreInProgress's own comment.
    markRestoreInProgress();
    window.location.reload();
  }

  return (
    <Modal title="Backup & Restore" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <p className="text-sm text-[var(--color-text-dim)] mb-3">
            Tables, bills, customers, orders — sab kuch ek file mein save ho jayega. PC reset ya
            naya device use karne se pehle ye zaroor download kar lo.
          </p>
          <button
            onClick={handleExport}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
          >
            <Download size={16} /> Download Backup
          </button>
        </div>

        <div className="pt-4 border-t border-[var(--color-border)]">
          <p className="text-sm text-[var(--color-text-dim)] mb-3">
            Pehle ki backup file se data wapas laane ke liye file choose karo.{" "}
            <span className="text-[var(--color-warning)]">
              Isse sab devices ka abhi ka live data replace ho jayega.
            </span>
          </p>
          <label className="w-full flex items-center justify-center rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-medium py-3 cursor-pointer">
            Choose Backup File
            <input type="file" accept="application/json" className="hidden" onChange={handleFilePicked} />
          </label>
          {error && <p className="text-xs text-[var(--color-danger)] mt-2">{error}</p>}
        </div>

        <div className="pt-4 border-t border-[var(--color-border)]">
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1.5">
            ADMIN PIN
          </p>
          <div className="flex gap-2">
            <input
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value);
                setPinSaved(false);
              }}
              inputMode="numeric"
              placeholder="Admin PIN"
              className="flex-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
            />
            <button
              onClick={handleSavePin}
              disabled={!pinInput.trim()}
              className="rounded-xl bg-[var(--color-primary)] disabled:opacity-40 text-white px-4 text-sm font-medium"
            >
              Save
            </button>
          </div>
          <p className="text-xs text-[var(--color-text-faint)] mt-1">
            Needed to open Menu Management, Deleted Bills, and Backup & Restore — separate from the
            app password, so staff who unlock the app can't touch these. Don't forget it.
          </p>
          {pinSaved && <p className="text-xs text-[var(--color-success)] mt-1">Saved.</p>}
        </div>
      </div>

      {pending && (
        <Modal title="Restore this backup?" onClose={() => setPending(null)}>
          <p className="text-sm text-[var(--color-text-dim)] mb-4">
            <span className="text-[var(--color-danger)] font-medium">
              Ye sirf is device ka nahi — sab devices ka abhi ka live data mit jayega
            </span>{" "}
            aur backup file wale data se replace ho jayega. Restore hone ke baad app reload ho
            jayega.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPending(null)}
              className="rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-medium py-2.5"
            >
              Cancel
            </button>
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="rounded-xl bg-[var(--color-warning)]/15 text-[var(--color-warning)] font-semibold py-2.5 disabled:opacity-50"
            >
              {restoring ? "Restoring…" : "Restore"}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function ExportExcelModal({ onClose }: { onClose: () => void }) {
  const bills = useBillsStore((s) => s.bills);
  const orders = useOrdersStore((s) => s.orders);
  const customers = useCustomersStore((s) => s.customers);
  const expenses = useExpensesStore((s) => s.expenses);
  const items = useMenuStore((s) => s.items);
  const categories = useMenuStore((s) => s.categories);
  const tables = useTablesStore((s) => s.tables);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const [working, setWorking] = useState(false);

  async function handleExport() {
    setWorking(true);
    try {
      // Loaded on demand — this library is only needed the moment someone
      // actually taps the button, so it never adds to the app's normal
      // load time.
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      type Row = Record<string, string | number>;
      const sum = (rows: Row[], key: string) =>
        rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);

      // A cancelled bill's numbers stay in its own row for the record, but
      // it never really happened as a sale — every TOTAL below, and the
      // Stock & Profit sheet, is based only on real (non-cancelled) bills.
      const activeBills = bills.filter((b) => b.status !== "cancelled");

      const billRows: Row[] = [...bills]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((b) => {
          const customer = customers.find((c) => c.id === b.customerId);
          return {
            Date: new Date(b.createdAt).toLocaleDateString([], { timeZone: IST_TIME_ZONE }),
            "Started At": b.tableId
              ? b.tableCharge > 0 && b.tableChargeMinutes <= 0
                ? "Not recorded"
                : new Date(b.createdAt - b.tableChargeMinutes * 60000).toLocaleTimeString([], {
                    timeZone: IST_TIME_ZONE,
                  })
              : "",
            "Ended At": new Date(b.createdAt).toLocaleTimeString([], { timeZone: IST_TIME_ZONE }),
            Table: b.tableName ?? "",
            Game: b.gameName ?? "",
            Customer: customer && !customer.isWalkIn ? customer.name : "Walk-in",
            "Who Played": (b.matchParticipants ?? []).join(", "),
            "Who Lost": (b.matchLosers ?? []).join(", "),
            "Table Charge": b.tableCharge,
            "Canteen Charge": b.canteenCharge,
            Discount: b.discount,
            Total: b.total,
            Status: b.status,
            "Payment Method": b.paymentMethod ?? "",
            "Amount Paid": b.amountPaid,
            Cash: b.amountCash,
            Account: b.amountUpi,
            "Amount on Credit": b.amountDue,
          };
        });
      if (billRows.length > 0) {
        const activeRows = billRows.filter((r) => r.Status !== "cancelled");
        billRows.push({
          Date: "TOTAL (cancelled excluded)",
          "Started At": "",
          "Ended At": "",
          Table: "",
          Game: "",
          Customer: "",
          "Who Played": "",
          "Who Lost": "",
          "Table Charge": sum(activeRows, "Table Charge"),
          "Canteen Charge": sum(activeRows, "Canteen Charge"),
          Discount: sum(activeRows, "Discount"),
          Total: sum(activeRows, "Total"),
          Status: "",
          "Payment Method": "",
          "Amount Paid": sum(activeRows, "Amount Paid"),
          Cash: sum(activeRows, "Cash"),
          Account: sum(activeRows, "Account"),
          "Amount on Credit": sum(activeRows, "Amount on Credit"),
        });
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(billRows), "Bills");

      const itemRows: Row[] = [...activeBills]
        .sort((a, b) => a.createdAt - b.createdAt)
        .flatMap((b) =>
          b.canteenItems.map((item) => ({
            Date: new Date(b.createdAt).toLocaleDateString([], { timeZone: IST_TIME_ZONE }),
            Table: b.tableName ?? "",
            Item: item.name,
            Qty: item.qty,
            Price: item.price,
            Amount: item.price * item.qty,
            "Ordered For": item.personName ?? "",
          }))
        );
      if (itemRows.length > 0) {
        itemRows.push({
          Date: "TOTAL",
          Table: "",
          Item: "",
          Qty: sum(itemRows, "Qty"),
          Price: "",
          Amount: sum(itemRows, "Amount"),
          "Ordered For": "",
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows), "Canteen Items");
      }

      const customerRows: Row[] = customers
        .filter((c) => !c.isWalkIn)
        .map((c) => ({
          Name: c.name,
          Phone: c.phone,
          "Credit Balance": creditBalanceFor(bills, c.id, normalizeName(c.name)),
          "Added On": new Date(c.createdAt).toLocaleDateString([], { timeZone: IST_TIME_ZONE }),
        }));
      if (customerRows.length > 0) {
        customerRows.push({
          Name: "TOTAL",
          Phone: "",
          "Credit Balance": sum(customerRows, "Credit Balance"),
          "Added On": "",
        });
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customerRows), "Customers");

      const expenseRows: Row[] = [...expenses]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((e) => ({
          Date: new Date(e.createdAt).toLocaleDateString([], { timeZone: IST_TIME_ZONE }),
          Category: e.category,
          Amount: e.amount,
          Note: e.note,
        }));
      if (expenseRows.length > 0) {
        expenseRows.push({ Date: "TOTAL", Category: "", Amount: sum(expenseRows, "Amount"), Note: "" });
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenseRows), "Expenses");

      // Real sales per item name — how much of each item actually sold, and
      // for how much — so it can be lined up against cost price for profit
      // and against current stock for what's still pending.
      const soldByName = new Map<string, { qty: number; revenue: number }>();
      for (const b of activeBills) {
        for (const line of b.canteenItems) {
          const existing = soldByName.get(line.name) ?? { qty: 0, revenue: 0 };
          existing.qty += line.qty;
          existing.revenue += line.price * line.qty;
          soldByName.set(line.name, existing);
        }
      }

      // A bill only remembers an item's name, not which menu item id was
      // sold, so two menu items sharing a name (e.g. two "kitkat" entries at
      // different prices) can't have their past sales told apart — grouping
      // by id here would silently hand all the sales to whichever one came
      // first and show 0 for the rest. Group by name instead so every item
      // with that name appears once, with their sales and stock combined.
      const itemsByName = new Map<string, MenuItem[]>();
      for (const i of items) {
        const list = itemsByName.get(i.name) ?? [];
        list.push(i);
        itemsByName.set(i.name, list);
      }
      const stockRows: Row[] = [...itemsByName.entries()].map(([name, variants]) => {
        const sold = soldByName.get(name) ?? { qty: 0, revenue: 0 };
        soldByName.delete(name);
        const prices = [...new Set(variants.map((v) => v.price))];
        const costs = [...new Set(variants.map((v) => v.costPrice).filter((c): c is number => c != null))];
        const cost = costs.length === 1 ? costs[0] : null;
        const cogs = cost != null ? cost * sold.qty : null;
        const stockQtys = variants.map((v) => v.stockQty);
        const stockQty = stockQtys.every((q) => q != null) ? stockQtys.reduce((s, q) => s + (q ?? 0), 0) : null;
        const lowThreshold = Math.min(...variants.map((v) => v.lowStockThreshold));
        return {
          Item: variants.length > 1 ? `${name} (${variants.length} menu entries, different prices)` : name,
          Category: categories.find((c) => c.id === variants[0].categoryId)?.name ?? "",
          "Selling Price": prices.length === 1 ? prices[0] : prices.join(" / "),
          "Cost Price": cost ?? (costs.length > 1 ? costs.join(" / ") : "Not set"),
          "Profit / Unit": cost != null && prices.length === 1 ? prices[0] - cost : "",
          "Qty Sold": sold.qty,
          "Qty In Stock (Pending)": stockQty ?? "Not tracked",
          "Stock Status":
            stockQty == null
              ? "Not tracked"
              : stockQty === 0
              ? "Out of stock — needs restocking"
              : stockQty <= lowThreshold
              ? "Running low"
              : "OK",
          Revenue: sold.revenue,
          "Total Cost": cogs ?? "",
          "Total Profit": cogs != null ? sold.revenue - cogs : "",
        };
      });
      // Anything left here sold under a name no longer in the current menu
      // (renamed/deleted item) — still counted so the totals below match
      // the Canteen Items sheet exactly.
      for (const [name, sold] of soldByName) {
        stockRows.push({
          Item: name,
          Category: "(removed from menu)",
          "Selling Price": "",
          "Cost Price": "",
          "Profit / Unit": "",
          "Qty Sold": sold.qty,
          "Qty In Stock (Pending)": "",
          "Stock Status": "",
          Revenue: sold.revenue,
          "Total Cost": "",
          "Total Profit": "",
        });
      }
      if (stockRows.length > 0) {
        stockRows.push({
          Item: "TOTAL",
          Category: "",
          "Selling Price": "",
          "Cost Price": "",
          "Profit / Unit": "",
          "Qty Sold": sum(stockRows, "Qty Sold"),
          "Qty In Stock (Pending)": "",
          "Stock Status": "",
          Revenue: sum(stockRows, "Revenue"),
          "Total Cost": sum(stockRows, "Total Cost"),
          "Total Profit": sum(stockRows, "Total Profit"),
        });
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stockRows), "Stock & Profit");

      // Same Food/Drinks/Cigarette/Chocolate rollup as the Monthly Report's
      // own cards — Sale, Purchase (from Settings → Expenses), and Profit
      // per category, across all time rather than one item per row.
      const categoryRows: Row[] = categoryStockProfit(orders, expenses, items, categories).map((c) => ({
        Category: c.sheet.replace(" collection", ""),
        Sale: c.sale,
        Purchase: c.purchase,
        Profit: c.profit,
        Items: c.itemCount,
      }));
      if (categoryRows.length > 0) {
        categoryRows.push({
          Category: "TOTAL",
          Sale: sum(categoryRows, "Sale"),
          Purchase: sum(categoryRows, "Purchase"),
          Profit: sum(categoryRows, "Profit"),
          Items: sum(categoryRows, "Items"),
        });
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categoryRows), "Category Stock & Profit");

      // Same day-by-day cash/account/credit breakdown as the Monthly
      // Report's own sheet, but across this export's whole history instead
      // of just the current month — one table/category row per date, only
      // where something was actually billed or collected.
      const dailyRows = dailyCollectionRows(activeBills, items, categories, orderedTables(tables));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows), "Daily collection");

      // Every credit settlement ever recorded, with the date of the oldest
      // charge it started clearing — a settlement is assumed to clear
      // whatever's been owed the longest first, since there's no record of
      // which specific past charge a given rupee of settlement was for.
      const settlementRows: Row[] = creditSettlementDetails(bills, customers)
        .sort((a, b) => a.date - b.date)
        .map((r) => ({
          Date: new Date(r.date).toLocaleString([], { timeZone: IST_TIME_ZONE }),
          Customer: r.customerName,
          "Amount settled": r.amount,
          "Oldest unpaid since": r.oldestUnpaidSince != null ? new Date(r.oldestUnpaidSince).toLocaleString([], { timeZone: IST_TIME_ZONE }) : "—",
          "Days pending": r.oldestUnpaidSince != null ? Math.round((r.date - r.oldestUnpaidSince) / 86400000) : "",
        }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(settlementRows), "Credit Settlements");

      XLSX.writeFile(wb, `cuebill-data-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal title="Export Data (Excel)" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-text-dim)]">
          Everything in one Excel file (.xlsx) — Bills, Canteen Items, Customers, Expenses,
          Stock &amp; Profit, Category Stock &amp; Profit (Food/Drinks/Cigarette/Chocolate
          Sale/Purchase/Profit across all time), Daily collection (day-by-day cash/account
          by table and item), and Credit Settlements (every payoff, with how much and the
          date of the oldest charge it started clearing) — each on its own sheet, with a
          TOTAL row at the end of every sheet. The Stock &amp; Profit sheet lists each item's
          cost price, per-unit and total profit, units sold, and units still in stock. Open
          it in Excel or Google Sheets to review, filter, or print. Amounts are in {currency}.
        </p>
        <p className="text-xs text-[var(--color-text-faint)]">
          Profit only shows for items with a Cost Price set in Menu Management — others show
          "Not set" in the Cost Price column.
        </p>
        <button
          onClick={handleExport}
          disabled={working}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] disabled:opacity-60 text-white font-semibold py-3"
        >
          <FileSpreadsheet size={16} /> {working ? "Preparing…" : "Download Excel File"}
        </button>
      </div>
    </Modal>
  );
}

function ThemeModal({ onClose }: { onClose: () => void }) {
  const themeColor = useSettingsStore((s) => s.themeColor);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const update = useSettingsStore((s) => s.update);

  return (
    <Modal title="Theme" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-3">
            MODE
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => update({ themeMode: "dark" })}
              className={
                "flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium " +
                (themeMode === "dark"
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-dim)]")
              }
            >
              <Moon size={15} /> Dark
            </button>
            <button
              onClick={() => update({ themeMode: "light" })}
              className={
                "flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium " +
                (themeMode === "light"
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-dim)]")
              }
            >
              <Sun size={15} /> Light
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-3">
            PRESETS
          </p>
          <div className="grid grid-cols-4 gap-3">
            {THEME_PRESETS.map((preset) => {
              const active = preset.hex.toLowerCase() === themeColor.toLowerCase();
              return (
                <button
                  key={preset.hex}
                  onClick={() => update({ themeColor: preset.hex })}
                  className="flex flex-col items-center gap-1.5"
                  title={preset.name}
                >
                  <span
                    className="h-11 w-11 rounded-full flex items-center justify-center border-2"
                    style={{
                      backgroundColor: preset.hex,
                      borderColor: active ? "var(--color-text)" : "transparent",
                    }}
                  >
                    {active && <Check size={18} className="text-white" />}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-dim)]">{preset.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--color-border)]">
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-3">
            OR PICK YOUR OWN
          </p>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={themeColor}
              onChange={(e) => update({ themeColor: e.target.value })}
              className="h-11 w-16 rounded-lg bg-transparent border border-[var(--color-border)] cursor-pointer"
            />
            <span className="text-sm text-[var(--color-text-dim)] uppercase">{themeColor}</span>
          </div>
        </div>

        {themeColor.toLowerCase() !== "#8b5cf6" && (
          <button
            onClick={() => update({ themeColor: "#8b5cf6" })}
            className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm font-medium py-2.5"
          >
            Reset to default purple
          </button>
        )}
      </div>
    </Modal>
  );
}

function ResetAllDataModal({ onClose }: { onClose: () => void }) {
  const tables = useTablesStore((s) => s.tables);
  const stopSession = useTablesStore((s) => s.stopSession);
  const storeName = useSettingsStore((s) => s.storeName);
  const resetBills = useBillsStore((s) => s.resetAll);
  const resetOrders = useOrdersStore((s) => s.resetAll);
  const resetCustomers = useCustomersStore((s) => s.resetAll);
  const resetExpenses = useExpensesStore((s) => s.resetAll);
  const [confirmText, setConfirmText] = useState("");
  const [done, setDone] = useState(false);

  // Typing the store's own name is a much higher bar than a generic word
  // like "DELETE" — this is a real business's live data, shared across every
  // device, with no undo and no trash to recover from.
  const canDelete = confirmText.trim().toLowerCase() === storeName.trim().toLowerCase() && storeName.trim().length > 0;

  function handleReset() {
    if (!canDelete) return;
    // Stop any live sessions first so no table is left pointing at a
    // customer that's about to be wiped.
    tables.forEach((t) => {
      if (t.status !== "available") stopSession(t.id);
    });
    resetBills();
    resetOrders();
    resetCustomers();
    resetExpenses();
    setDone(true);
  }

  if (done) {
    return (
      <Modal title="Data cleared" onClose={onClose}>
        <p className="text-sm text-[var(--color-text-dim)] mb-4">
          Bills, sessions, customers, canteen orders and expenses are gone. Your menu, tables,
          games and store settings are untouched — you're ready to start fresh.
        </p>
        <button
          onClick={onClose}
          className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
        >
          Done
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Reset Data" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3">
          <p className="text-sm font-semibold text-[var(--color-danger)] flex items-center gap-1.5">
            <AlertTriangle size={15} /> This can't be undone
          </p>
          <p className="text-xs text-[var(--color-text-dim)] mt-1.5">
            Every bill, session history, customer, canteen order and expense — on every device
            signed into this cafe — will be permanently deleted. Any table currently running
            will be stopped.
          </p>
        </div>
        <p className="text-xs text-[var(--color-text-dim)]">
          Your menu, tables, games, and store settings (name, currency, password, theme) are
          kept.
        </p>
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1.5">
            TYPE "{storeName}" TO CONFIRM
          </p>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={storeName}
            className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <button
          onClick={handleReset}
          disabled={!canDelete}
          className="w-full rounded-xl bg-[var(--color-danger)] disabled:opacity-40 text-white font-semibold py-3"
        >
          Delete everything
        </button>
      </div>
    </Modal>
  );
}
