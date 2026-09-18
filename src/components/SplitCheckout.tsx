import { useState } from "react";
import { Modal } from "./ui/Modal";
import { useBillsStore } from "../store/useBillsStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useTablesStore } from "../store/useTablesStore";
import { useGamesStore } from "../store/useGamesStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney } from "../lib/format";
import type { Bill, BillShare, PaymentMethod } from "../types";
import { QRCodeSVG } from "qrcode.react";
import { Check, ArrowLeft, Repeat, Gamepad2, UtensilsCrossed, Wallet } from "lucide-react";

// A small visual cue for what each share is for — falls back to a generic
// wallet icon for any label that isn't "Table charge" or "Food" (e.g. the
// plain "Share" label an older, single-pool split bill might still have).
function shareIcon(label: string) {
  const l = label.toLowerCase();
  if (l.includes("table")) return Gamepad2;
  if (l.includes("food")) return UtensilsCrossed;
  return Wallet;
}

type RowStep = "idle" | "upi-qr";

export function SplitCheckout({ bill: initialBill, onDone }: { bill: Bill; onDone: () => void }) {
  const currency = useSettingsStore((s) => s.currencySymbol);
  const storeName = useSettingsStore((s) => s.storeName);
  const upiId = useSettingsStore((s) => s.upiId);
  const settleShare = useBillsStore((s) => s.settleShare);
  const findOrCreateCustomer = useCustomersStore((s) => s.findOrCreateCustomer);
  const adjustCredit = useCustomersStore((s) => s.adjustCredit);
  const tables = useTablesStore((s) => s.tables);
  const startSession = useTablesStore((s) => s.startSession);
  const games = useGamesStore((s) => s.games);
  // `initialBill` is a snapshot from the moment checkout opened — read the
  // live copy from the store instead so each share flips to "paid" on
  // screen the instant it's settled, without needing to close and reopen.
  const bill =
    useBillsStore((s) => s.bills.find((b) => b.id === initialBill.id) ?? s.deletedBills.find((b) => b.id === initialBill.id)) ??
    initialBill;

  const [steps, setSteps] = useState<Record<string, RowStep>>({});

  const shares = bill.shares ?? [];
  const allPaid = shares.length > 0 && shares.every((s) => s.status === "paid");
  const anyPaid = shares.some((s) => s.status === "paid");
  const pendingShares = shares.filter((s) => s.status !== "paid");
  // Grouped by payer for a cleaner, per-person view — table charge and food
  // stay independently payable, just visually kept under the one person
  // they both belong to instead of scattered as separate flat cards.
  const groupedByPayer: { payerName: string; shares: BillShare[] }[] = [];
  for (const share of shares) {
    const group = groupedByPayer.find((g) => g.payerName === share.payerName);
    if (group) group.shares.push(share);
    else groupedByPayer.push({ payerName: share.payerName, shares: [share] });
  }
  // Once someone's paid and left, whoever's still playing can carry on on
  // the same table — a fresh session for just them, timer back at zero,
  // billed properly whenever they actually finish.
  const restartTable = bill.tableId ? tables.find((t) => t.id === bill.tableId) : null;
  const canRestart =
    anyPaid && !allPaid && !!restartTable && restartTable.status === "available" && pendingShares.length > 0;
  // Once every share is settled, offer a fresh rematch for the whole group —
  // same players, same game, timer back at zero.
  const canRestartAll =
    allPaid && !!restartTable && restartTable.status === "available" && !!bill.matchParticipants?.length;

  function handleRestartForRest() {
    if (!restartTable || pendingShares.length === 0) return;
    const [primaryName, ...restNames] = pendingShares.map((s) => s.payerName);
    const primary = findOrCreateCustomer({ name: primaryName, phone: "" });
    const extraCustomerIds = restNames.map((name) => findOrCreateCustomer({ name, phone: "" }).id);
    const game = bill.gameId ? games.find((g) => g.id === bill.gameId) : undefined;
    startSession(restartTable.id, primary.id, {
      extraCustomerIds,
      gameId: game?.id ?? null,
      ratePerHour: game?.ratePerHour ?? null,
    });
    onDone();
  }

  function handleRestartAll() {
    if (!restartTable || !bill.matchParticipants?.length) return;
    const [primaryName, ...restNames] = bill.matchParticipants;
    const primary = findOrCreateCustomer({ name: primaryName, phone: "" });
    const extraCustomerIds = restNames.map((name) => findOrCreateCustomer({ name, phone: "" }).id);
    const game = bill.gameId ? games.find((g) => g.id === bill.gameId) : undefined;
    startSession(restartTable.id, primary.id, {
      extraCustomerIds,
      gameId: game?.id ?? null,
      ratePerHour: game?.ratePerHour ?? null,
    });
    onDone();
  }

  function setStep(shareId: string, step: RowStep) {
    setSteps((s) => ({ ...s, [shareId]: step }));
  }

  function settle(share: BillShare, method: PaymentMethod) {
    settleShare(bill.id, share.id, { method });
    if (method === "credit") {
      // Matches an existing customer by the share's payer name, so the same
      // person's credit lands on one profile instead of splintering.
      const customer = findOrCreateCustomer({ name: share.payerName, phone: "" });
      adjustCredit(customer.id, share.amount);
    }
    setStep(share.id, "idle");
  }

  return (
    <Modal title="Split bill" onClose={onDone}>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-[var(--color-surface-2)] px-4 py-3">
          <span className="text-sm text-[var(--color-text-dim)]">Total</span>
          <span className="text-lg font-bold">{formatMoney(bill.total, currency)}</span>
        </div>

        {groupedByPayer.map(({ payerName, shares: payerShares }) => {
          const payerTotal = payerShares.reduce((sum, s) => sum + s.amount, 0);
          const payerFullyPaid = payerShares.every((s) => s.status === "paid");
          return (
            <div
              key={payerName}
              className={
                "rounded-2xl border overflow-hidden " +
                (payerFullyPaid
                  ? "border-[var(--color-success)]/40"
                  : "border-[var(--color-border)]")
              }
            >
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[var(--color-surface-2)]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)] flex items-center justify-center text-sm font-semibold">
                    {payerName.charAt(0).toUpperCase()}
                  </div>
                  <p className="text-sm font-semibold truncate">{payerName}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {payerFullyPaid && <Check size={14} className="text-[var(--color-success)]" />}
                  <span className="text-sm font-bold">{formatMoney(payerTotal, currency)}</span>
                </div>
              </div>

              <div className="divide-y divide-[var(--color-border)] bg-[var(--color-surface)]">
                {payerShares.map((share) => {
                  const step = steps[share.id] ?? "idle";
                  const Icon = shareIcon(share.label);
                  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
                    storeName
                  )}&am=${share.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(share.label)}`;

                  if (share.status === "paid") {
                    const onCredit = share.paymentMethod === "credit";
                    return (
                      <div key={share.id} className="flex items-center justify-between gap-2 px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={
                              "h-7 w-7 shrink-0 rounded-full flex items-center justify-center " +
                              (onCredit
                                ? "bg-[var(--color-warning)]/15 text-[var(--color-warning)]"
                                : "bg-[var(--color-success)]/15 text-[var(--color-success)]")
                            }
                          >
                            <Check size={13} />
                          </div>
                          <p className="text-sm truncate">{share.label}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-medium">{formatMoney(share.amount, currency)}</p>
                          <p
                            className={
                              "text-xs capitalize " +
                              (onCredit ? "text-[var(--color-warning)]" : "text-[var(--color-text-faint)]")
                            }
                          >
                            {onCredit ? "on credit" : share.paymentMethod}
                          </p>
                        </div>
                      </div>
                    );
                  }

                  if (step === "upi-qr") {
                    return (
                      <div key={share.id} className="px-4 py-3">
                        <div className="flex items-center gap-2 mb-2">
                          <button
                            onClick={() => setStep(share.id, "idle")}
                            className="h-7 w-7 flex items-center justify-center rounded-full bg-[var(--color-surface-2)]"
                          >
                            <ArrowLeft size={12} />
                          </button>
                          <p className="text-xs text-[var(--color-text-dim)]">{share.label}</p>
                        </div>
                        <div className="flex flex-col items-center gap-2 py-3">
                          <div className="rounded-xl bg-white p-2">
                            <QRCodeSVG value={upiUri} size={150} />
                          </div>
                          <p className="text-xl font-bold">{formatMoney(share.amount, currency)}</p>
                        </div>
                        <button
                          onClick={() => settle(share, "upi")}
                          className="w-full rounded-xl bg-[var(--color-success)]/15 text-[var(--color-success)] font-semibold py-2.5 text-sm"
                        >
                          Payment received
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div key={share.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon size={14} className="text-[var(--color-text-faint)] shrink-0" />
                          <p className="text-sm truncate">{share.label}</p>
                        </div>
                        <p className="text-sm font-semibold shrink-0">{formatMoney(share.amount, currency)}</p>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          onClick={() => settle(share, "cash")}
                          className="rounded-lg bg-[var(--color-success)]/15 text-[var(--color-success)] font-medium py-2 text-xs active:scale-95 transition-transform"
                        >
                          Cash
                        </button>
                        <button
                          onClick={() => (upiId ? setStep(share.id, "upi-qr") : settle(share, "upi"))}
                          className="rounded-lg bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-medium py-2 text-xs active:scale-95 transition-transform"
                        >
                          Account
                        </button>
                        <button
                          onClick={() => settle(share, "credit")}
                          className="rounded-lg bg-[var(--color-warning)]/15 text-[var(--color-warning)] font-medium py-2 text-xs active:scale-95 transition-transform"
                        >
                          Credit
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {allPaid && (
          <p className="text-center text-sm text-[var(--color-success)] font-medium">
            All shares settled ✓
          </p>
        )}

        {canRestart && (
          <button
            onClick={handleRestartForRest}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
          >
            <Repeat size={15} /> Restart for {pendingShares.map((s) => s.payerName).join(", ")}
          </button>
        )}

        <button
          onClick={onDone}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-semibold py-3"
        >
          {allPaid ? (
            "Done"
          ) : anyPaid ? (
            "Close (remaining shares stay open)"
          ) : (
            <>
              <ArrowLeft size={15} /> Back
            </>
          )}
        </button>

        {canRestartAll && (
          <button
            onClick={handleRestartAll}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-semibold py-3"
          >
            <Repeat size={15} /> Restart same session
          </button>
        )}
      </div>
    </Modal>
  );
}
