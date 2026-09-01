import { useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { useTablesStore } from "../store/useTablesStore";
import { useMenuStore } from "../store/useMenuStore";
import { useGamesStore } from "../store/useGamesStore";
import { useBillsStore } from "../store/useBillsStore";
import { useOrdersStore } from "../store/useOrdersStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useExpensesStore } from "../store/useExpensesStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { useAuthStore } from "../store/useAuthStore";
import { formatMoney, formatDateTime } from "../lib/format";
import {
  LayoutGrid,
  Tag,
  UtensilsCrossed,
  Store,
  Users,
  ChevronRight,
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
} from "lucide-react";

type Panel = "tables" | "rates" | "games" | "menu" | "store" | "trash" | "backup" | "theme" | "danger" | null;

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
            <p className="text-sm font-medium">Reset All Data</p>
            <p className="text-xs text-[var(--color-text-dim)]">
              Permanently erase bills, customers, orders, expenses and menu
            </p>
          </div>
        </div>
        <ChevronRight size={16} className="text-[var(--color-text-faint)]" />
      </Card>

      {panel === "tables" && <TableManagementModal onClose={() => setPanel(null)} />}
      {panel === "rates" && <TableRatesModal onClose={() => setPanel(null)} />}
      {panel === "games" && <GamesRatesModal onClose={() => setPanel(null)} />}
      {panel === "menu" && <MenuManagementModal onClose={() => setPanel(null)} />}
      {panel === "store" && <StoreSettingsModal onClose={() => setPanel(null)} />}
      {panel === "trash" && <DeletedBillsModal onClose={() => setPanel(null)} />}
      {panel === "backup" && <BackupModal onClose={() => setPanel(null)} />}
      {panel === "theme" && <ThemeModal onClose={() => setPanel(null)} />}
      {panel === "danger" && <ResetAllDataModal onClose={() => setPanel(null)} />}
    </AppShell>
  );
}

function TableManagementModal({ onClose }: { onClose: () => void }) {
  const tables = useTablesStore((s) => s.tables);
  const addTable = useTablesStore((s) => s.addTable);
  const removeTable = useTablesStore((s) => s.removeTable);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("PlayStation");
  const [rate, setRate] = useState("60");

  function handleAdd() {
    if (!name.trim()) return;
    addTable({ name: name.trim(), kind, ratePerHour: Math.max(0, Number(rate) || 0), note: "" });
    setName("");
  }

  return (
    <Modal title="Table Management" onClose={onClose}>
      <div className="space-y-2 mb-4">
        {tables.map((t) => (
          <Card key={t.id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t.name}</p>
              <p className="text-xs text-[var(--color-text-dim)]">{t.kind}</p>
            </div>
            <button
              onClick={() => removeTable(t.id)}
              disabled={t.status !== "available"}
              className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)] disabled:opacity-30"
            >
              <Trash2 size={14} />
            </button>
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
  const addCategory = useMenuStore((s) => s.addCategory);
  const currency = useSettingsStore((s) => s.currencySymbol);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [newCategory, setNewCategory] = useState("");

  function handleAddItem() {
    if (!name.trim() || !categoryId) return;
    addItem({
      name: name.trim(),
      price: Math.max(0, Number(price) || 0),
      categoryId,
      inStock: true,
      stockQty: stock.trim() === "" ? null : Math.max(0, Number(stock) || 0),
      lowStockThreshold: 5,
    });
    setName("");
    setPrice("");
    setStock("");
  }

  function handleAddCategory() {
    if (!newCategory.trim()) return;
    addCategory(newCategory.trim());
    setNewCategory("");
  }

  return (
    <Modal title="Menu Management" onClose={onClose}>
      <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
        {items.map((item) => {
          const cat = categories.find((c) => c.id === item.categoryId);
          const low = item.stockQty != null && item.stockQty <= item.lowStockThreshold;
          return (
            <Card key={item.id}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-[var(--color-text-dim)]">
                    {cat?.name} · {formatMoney(item.price, currency)}
                  </p>
                </div>
                <button
                  onClick={() => removeItem(item.id)}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--color-border)]">
                <span className={"text-xs " + (low ? "text-[var(--color-danger)] font-medium" : "text-[var(--color-text-dim)]")}>
                  {item.stockQty == null ? "Stock not tracked" : `${item.stockQty} in stock${low ? " · low!" : ""}`}
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

      <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
        <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">
          ADD CATEGORY
        </p>
        <div className="flex gap-2">
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Category name"
            className="flex-1 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
          <button
            onClick={handleAddCategory}
            className="rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 text-sm font-medium"
          >
            Add
          </button>
        </div>
      </div>
    </Modal>
  );
}

function StoreSettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettingsStore();
  const lock = useAuthStore((s) => s.lock);
  const [storeName, setStoreName] = useState(settings.storeName);
  const [currencySymbol, setCurrencySymbol] = useState(settings.currencySymbol);
  const [upiId, setUpiId] = useState(settings.upiId);
  const [appPassword, setAppPassword] = useState(settings.appPassword);

  function handleSave() {
    settings.update({
      storeName,
      currencySymbol,
      upiId: upiId.trim(),
      appPassword: appPassword.trim() || settings.appPassword,
    });
    onClose();
  }

  function handleLockNow() {
    settings.update({
      storeName,
      currencySymbol,
      upiId: upiId.trim(),
      appPassword: appPassword.trim() || settings.appPassword,
    });
    lock();
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
        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-1.5">
            APP PASSWORD
          </p>
          <input
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder="Shared password for this device"
            className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-sm outline-none"
          />
          <p className="text-xs text-[var(--color-text-faint)] mt-1">
            Whoever opens the app on this device needs this to get in. It's a simple deterrent,
            not real security — change it from the default before going live.
          </p>
        </div>
        <button
          onClick={handleSave}
          className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
        >
          Save
        </button>
        <button
          onClick={handleLockNow}
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm font-medium py-2.5"
        >
          Lock this device now
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
          Nothing here. Bills you delete from Sessions show up in this list first.
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
  const [pending, setPending] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);

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
            <span className="text-[var(--color-warning)]">Isse abhi ka data replace ho jayega.</span>
          </p>
          <label className="w-full flex items-center justify-center rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-medium py-3 cursor-pointer">
            Choose Backup File
            <input type="file" accept="application/json" className="hidden" onChange={handleFilePicked} />
          </label>
          {error && <p className="text-xs text-[var(--color-danger)] mt-2">{error}</p>}
        </div>
      </div>

      {pending && (
        <Modal title="Restore this backup?" onClose={() => setPending(null)}>
          <p className="text-sm text-[var(--color-text-dim)] mb-4">
            Is device ka current data mit jayega aur backup file wale data se replace ho jayega.
            Restore hone ke baad app reload ho jayega.
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
  const resetMenu = useMenuStore((s) => s.resetAll);
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
    resetMenu();
    resetExpenses();
    setDone(true);
  }

  if (done) {
    return (
      <Modal title="All data cleared" onClose={onClose}>
        <p className="text-sm text-[var(--color-text-dim)] mb-4">
          Bills, sessions, customers, canteen orders, expenses and the menu are all gone —
          tables, games, and store settings are untouched. Add menu items again from Menu
          Management whenever you're ready.
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
    <Modal title="Reset All Data" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3">
          <p className="text-sm font-semibold text-[var(--color-danger)] flex items-center gap-1.5">
            <AlertTriangle size={15} /> This can't be undone
          </p>
          <p className="text-xs text-[var(--color-text-dim)] mt-1.5">
            Every bill, session history, customer, canteen order, expense and menu item — on
            every device signed into this cafe — will be permanently deleted. Any table
            currently running will be stopped.
          </p>
        </div>
        <p className="text-xs text-[var(--color-text-dim)]">
          Tables, games, and store settings (name, currency, password, theme) are kept.
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
