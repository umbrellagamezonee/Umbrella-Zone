import { useState } from "react";
import { useCustomersStore } from "../../store/useCustomersStore";
import { useBillsStore } from "../../store/useBillsStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { normalizeName, customerLabel } from "../../lib/customerName";
import { creditBalanceFor } from "../../lib/billing";
import { formatMoney } from "../../lib/format";
import { Check } from "lucide-react";

// A name field that surfaces customers you already have as you type. Tapping
// one drops in that exact name so the session/bill attaches to their existing
// profile — the daily regular stops turning into a new entry every visit.
// Typing a fresh name and just carrying on still creates someone new.
//
// The suggestion list is rendered inline (it pushes content down) rather than
// as an overlay, so it can't get clipped by a scrolling modal.
export function CustomerNameInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  onEnter,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  const customers = useCustomersStore((s) => s.customers);
  const bills = useBillsStore((s) => s.bills);
  const currency = useSettingsStore((s) => s.currencySymbol);
  const [focused, setFocused] = useState(false);

  const key = normalizeName(value);
  const matches =
    key.length === 0
      ? []
      : customers
          .filter((c) => !c.isWalkIn && normalizeName(c.name).includes(key))
          .sort((a, b) => {
            // Exact matches first, then people who owe money, then A–Z.
            const aExact = normalizeName(a.name) === key ? 0 : 1;
            const bExact = normalizeName(b.name) === key ? 0 : 1;
            if (aExact !== bExact) return aExact - bExact;
            const aDue = creditBalanceFor(bills, a.id, normalizeName(a.name)) > 0 ? 0 : 1;
            const bDue = creditBalanceFor(bills, b.id, normalizeName(b.name)) > 0 ? 0 : 1;
            if (aDue !== bDue) return aDue - bDue;
            return a.name.localeCompare(b.name);
          })
          .slice(0, 6);

  const exactId = customers.find((c) => !c.isWalkIn && normalizeName(c.name) === key)?.id ?? null;

  return (
    <div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        // Delay so a tap on a suggestion registers before the list unmounts.
        onBlur={() => window.setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
          if (e.key === "Escape") setFocused(false);
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-3 text-base outline-none focus:border-[var(--color-primary)]"
      />
      {focused && matches.length > 0 && (
        <div className="mt-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          {matches.map((c) => {
            const isExact = c.id === exactId;
            const due = creditBalanceFor(bills, c.id, normalizeName(c.name));
            return (
              <button
                key={c.id}
                type="button"
                // mouseDown (not click) so it fires before the input's blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c.name);
                  setFocused(false);
                }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-2)]"
              >
                <span className="flex items-center gap-1.5 text-sm">
                  {isExact && <Check size={13} className="text-[var(--color-success)] shrink-0" />}
                  {customerLabel(c, customers)}
                </span>
                {due > 0 && (
                  <span className="text-xs text-[var(--color-warning)] shrink-0">
                    {formatMoney(due, currency)} due
                  </span>
                )}
              </button>
            );
          })}
          <p className="px-3 py-1.5 text-[11px] text-[var(--color-text-faint)] bg-[var(--color-surface-2)]">
            {exactId
              ? "Already a customer — this attaches to their history"
              : "Tap a regular to reuse them · keep typing for someone new"}
          </p>
        </div>
      )}
    </div>
  );
}
