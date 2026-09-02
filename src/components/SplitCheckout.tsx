import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Card } from "./ui/Card";
import { useBillsStore } from "../store/useBillsStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useTablesStore } from "../store/useTablesStore";
import { useGamesStore } from "../store/useGamesStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney } from "../lib/format";
import type { Bill, BillShare, PaymentMethod } from "../types";
import { QRCodeSVG } from "qrcode.react";
import { Check, ArrowLeft, Repeat } from "lucide-react";

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
  // Once someone's paid and left, whoever's still playing can carry on on
  // the same table — a fresh session for just them, timer back at zero,
  // billed properly whenever they actually finish.
  const restartTable = bill.tableId ? tables.find((t) => t.id === bill.tableId) : null;
  const canRestart =
    anyPaid && !allPaid && !!restartTable && restartTable.status === "available" && pendingShares.length > 0;

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
    <Modal title={`Split bill · ${formatMoney(bill.total, currency)}`} onClose={onDone}>
      <div className="space-y-3">
        {shares.map((share) => {
          const step = steps[share.id] ?? "idle";
          const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
            storeName
          )}&am=${share.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(share.label)}`;

          if (share.status === "paid") {
            return (
              <Card key={share.id} className="border-[var(--color-success)]/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] flex items-center justify-center">
                      <Check size={14} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{share.label}</p>
                      <p className="text-xs text-[var(--color-text-dim)]">{share.payerName}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatMoney(share.amount, currency)}</p>
                    <p className="text-xs text-[var(--color-text-faint)] capitalize">
                      {share.paymentMethod}
                    </p>
                  </div>
                </div>
              </Card>
            );
          }

          if (step === "upi-qr") {
            return (
              <Card key={share.id}>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={() => setStep(share.id, "idle")}
                    className="h-7 w-7 flex items-center justify-center rounded-full bg-[var(--color-surface-2)]"
                  >
                    <ArrowLeft size={12} />
                  </button>
                  <p className="text-xs text-[var(--color-text-dim)]">
                    {share.label} · {share.payerName}
                  </p>
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
              </Card>
            );
          }

          return (
            <Card key={share.id}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-medium">{share.label}</p>
                  <p className="text-xs text-[var(--color-text-dim)]">{share.payerName}</p>
                </div>
                <p className="text-sm font-semibold">{formatMoney(share.amount, currency)}</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => settle(share, "cash")}
                  className="rounded-xl bg-[var(--color-success)]/15 text-[var(--color-success)] font-medium py-2 text-xs"
                >
                  Cash
                </button>
                <button
                  onClick={() => (upiId ? setStep(share.id, "upi-qr") : settle(share, "upi"))}
                  className="rounded-xl bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-medium py-2 text-xs"
                >
                  UPI
                </button>
                <button
                  onClick={() => settle(share, "credit")}
                  className="rounded-xl bg-[var(--color-warning)]/15 text-[var(--color-warning)] font-medium py-2 text-xs"
                >
                  Credit
                </button>
              </div>
            </Card>
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
      </div>
    </Modal>
  );
}
