import { useMemo, useState } from "react";
import { Modal } from "./ui/Modal";
import { Card } from "./ui/Card";
import { useMenuStore } from "../store/useMenuStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney } from "../lib/format";
import type { OrderLineItem } from "../types";
import { Lock } from "lucide-react";

interface ShareRow {
  key: string;
  label: string;
  amount: number;
}

interface ShareOutput {
  label: string;
  payerName: string;
  amount: number;
}

export function SplitBillModal({
  tableCharge,
  canteenItems,
  participantNames = [],
  onClose,
  onConfirm,
}: {
  tableCharge: number;
  canteenItems: OrderLineItem[];
  participantNames?: string[];
  onClose: () => void;
  onConfirm: (shares: ShareOutput[]) => void;
}) {
  const menuItems = useMenuStore((s) => s.items);
  const categories = useMenuStore((s) => s.categories);
  const currency = useSettingsStore((s) => s.currencySymbol);

  const rows: ShareRow[] = useMemo(() => {
    const result: ShareRow[] = [];
    if (tableCharge > 0) {
      result.push({ key: "table", label: "Table charge", amount: tableCharge });
    }
    const categorizedItemIds = new Set<string>();
    for (const cat of categories) {
      const catItemIds = menuItems.filter((i) => i.categoryId === cat.id).map((i) => i.id);
      catItemIds.forEach((id) => categorizedItemIds.add(id));
      const amount = canteenItems
        .filter((line) => catItemIds.includes(line.menuItemId))
        .reduce((sum, line) => sum + line.price * line.qty, 0);
      if (amount > 0) result.push({ key: cat.id, label: cat.name, amount });
    }
    // Items whose menu entry/category was deleted after being ordered still need
    // to be assigned to someone — never let money silently drop out of the split.
    const otherAmount = canteenItems
      .filter((line) => !categorizedItemIds.has(line.menuItemId))
      .reduce((sum, line) => sum + line.price * line.qty, 0);
    if (otherAmount > 0) result.push({ key: "other", label: "Other items", amount: otherAmount });
    return result;
  }, [tableCharge, canteenItems, categories, menuItems]);

  const [payerNames, setPayerNames] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);

  const allFilled = rows.length > 0 && rows.every((r) => (payerNames[r.key] ?? "").trim().length > 0);

  function handleConfirm() {
    if (!allFilled) return;
    setConfirmed(true);
    onConfirm(rows.map((r) => ({ label: r.label, payerName: payerNames[r.key].trim(), amount: r.amount })));
  }

  return (
    <Modal title="Split bill" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-[var(--color-text-faint)]">
          Assign each portion to the person paying for it. Once locked, this split can't be
          changed — only settled.
        </p>

        <div className="space-y-2">
          {rows.map((row) => (
            <Card key={row.key}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-sm font-semibold">{formatMoney(row.amount, currency)}</p>
              </div>
              <input
                value={payerNames[row.key] ?? ""}
                onChange={(e) => setPayerNames((p) => ({ ...p, [row.key]: e.target.value }))}
                disabled={confirmed}
                placeholder="Who's paying for this?"
                className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-sm outline-none disabled:opacity-60"
              />
              {!confirmed && participantNames.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {participantNames.map((name) => (
                    <button
                      key={name}
                      onClick={() => setPayerNames((p) => ({ ...p, [row.key]: name }))}
                      className="text-xs rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[var(--color-text-dim)]"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>

        {rows.length === 0 && (
          <p className="text-sm text-[var(--color-text-faint)] text-center py-4">
            Nothing to split yet.
          </p>
        )}

        <button
          onClick={handleConfirm}
          disabled={!allFilled || confirmed}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] disabled:opacity-40 text-white font-semibold py-3"
        >
          <Lock size={15} /> Lock split & stop
        </button>
      </div>
    </Modal>
  );
}
