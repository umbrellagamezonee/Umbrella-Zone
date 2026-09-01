import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Card } from "./ui/Card";
import { useBillsStore } from "../store/useBillsStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney } from "../lib/format";
import type { Bill, BillShare, PaymentMethod } from "../types";
import { QRCodeSVG } from "qrcode.react";
import { Check, ArrowLeft } from "lucide-react";

type RowStep = "idle" | "upi-qr";

export function SplitCheckout({ bill, onDone }: { bill: Bill; onDone: () => void }) {
  const currency = useSettingsStore((s) => s.currencySymbol);
  const storeName = useSettingsStore((s) => s.storeName);
  const upiId = useSettingsStore((s) => s.upiId);
  const settleShare = useBillsStore((s) => s.settleShare);
  const findOrCreateCustomer = useCustomersStore((s) => s.findOrCreateCustomer);
  const adjustCredit = useCustomersStore((s) => s.adjustCredit);

  const [steps, setSteps] = useState<Record<string, RowStep>>({});

  const shares = bill.shares ?? [];
  const allPaid = shares.length > 0 && shares.every((s) => s.status === "paid");

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

        <button
          onClick={onDone}
          className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-semibold py-3"
        >
          {allPaid ? "Done" : "Close (unpaid shares stay open)"}
        </button>
      </div>
    </Modal>
  );
}
