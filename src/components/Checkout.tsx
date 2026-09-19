import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Card } from "./ui/Card";
import { useBillsStore } from "../store/useBillsStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { CustomerNameInput } from "./ui/CustomerNameInput";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney } from "../lib/format";
import type { Bill } from "../types";
import { Check, ArrowLeft, Repeat } from "lucide-react";

type CheckoutStep = "select" | "success";

interface CheckoutProps {
  bill: Bill;
  onDone: () => void;
  // Present only when there's something to undo (e.g. a session that was
  // stopped the moment checkout opened) — closing before paying reverts that
  // instead of just abandoning an orphaned bill.
  onCancel?: () => void;
  // Fires the instant payment is recorded, before the success screen shows —
  // callers use it to drop any pending "undo" so a later close never reverts
  // a bill that's actually been paid.
  onSettled?: () => void;
  // Offered once payment is confirmed — leaves this bill exactly as settled
  // and starts a fresh session right away for the same players, same game.
  onRestart?: () => void;
}

export function CheckoutModal({ bill, onDone, onCancel, onSettled, onRestart }: CheckoutProps) {
  return (
    <Modal title={bill.tableName ?? "Checkout"} onClose={onCancel ?? onDone}>
      <Checkout
        bill={bill}
        onDone={onDone}
        onCancel={onCancel}
        onSettled={onSettled}
        onRestart={onRestart}
      />
    </Modal>
  );
}

export function Checkout({ bill, onDone, onCancel, onSettled, onRestart }: CheckoutProps) {
  const currency = useSettingsStore((s) => s.currencySymbol);
  const settlePayment = useBillsStore((s) => s.settlePayment);
  const customers = useCustomersStore((s) => s.customers);
  const findOrCreateCustomer = useCustomersStore((s) => s.findOrCreateCustomer);
  const adjustCredit = useCustomersStore((s) => s.adjustCredit);

  const billCustomer = customers.find((c) => c.id === bill.customerId) ?? null;
  const isRegistered = !!billCustomer && !billCustomer.isWalkIn;
  // Every bill — table or canteen — settles straight to credit here. No
  // on-the-spot cash/account collection at all; that happens later from the
  // customer's own profile (Settle payment), so nobody has to stop and
  // handle cash mid-session or mid-counter.
  const needsContact = !isRegistered;

  const [step, setStep] = useState<CheckoutStep>("select");
  const [payerName, setPayerName] = useState(
    billCustomer && !billCustomer.isWalkIn ? billCustomer.name : ""
  );
  const [settled, setSettled] = useState<{ creditTo: string | null } | null>(null);
  const [error, setError] = useState("");

  function handleConfirm() {
    if (needsContact && !payerName.trim()) {
      setError("Enter a name so this balance can be tracked.");
      return;
    }
    setError("");
    let creditCustomerId = bill.customerId;
    let creditCustomerName = billCustomer?.name ?? null;

    if (!isRegistered) {
      // Matches an existing customer by name so the same person's credit
      // keeps landing on one profile instead of splintering into duplicates.
      const c = findOrCreateCustomer({ name: payerName.trim(), phone: "" });
      creditCustomerId = c.id;
      creditCustomerName = c.name;
    }

    const updated = settlePayment(bill.id, { amountCash: 0, amountUpi: 0 });
    if (updated && bill.total > 0 && creditCustomerId) {
      adjustCredit(creditCustomerId, bill.total);
    }
    onSettled?.();
    setSettled({ creditTo: bill.total > 0 ? creditCustomerName : null });
    setStep("success");
  }

  if (step === "success" && settled) {
    return (
      <div className="space-y-4 py-4 text-center">
        <div className="mx-auto h-16 w-16 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] flex items-center justify-center">
          <Check size={32} />
        </div>
        <div>
          <p className="text-sm text-[var(--color-text-dim)] mt-1">Fully on credit</p>
          {settled.creditTo && (
            <p className="text-sm text-[var(--color-warning)] mt-2">
              {formatMoney(bill.total, currency)} added to {settled.creditTo}'s credit
            </p>
          )}
        </div>
        <button
          onClick={onDone}
          className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
        >
          Done
        </button>
        {onRestart && (
          <button
            onClick={onRestart}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-semibold py-3"
          >
            <Repeat size={15} /> Restart same session
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {onCancel && (
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 text-sm text-[var(--color-text-dim)]"
        >
          <ArrowLeft size={14} /> Back
        </button>
      )}

      <Card>
        {bill.tableCharge > 0 && (
          <div className="flex justify-between text-sm py-1">
            <span className="text-[var(--color-text-dim)]">Table charge</span>
            <span>{formatMoney(bill.tableCharge, currency)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm py-1">
          <span className="text-[var(--color-text-dim)]">Canteen</span>
          <span>{formatMoney(bill.canteenCharge, currency)}</span>
        </div>
        {bill.canteenItems.length > 0 && (
          <div className="pb-1 space-y-0.5">
            {bill.canteenItems.map((item, idx) => (
              <div key={idx} className="flex justify-between text-xs text-[var(--color-text-faint)] pl-2">
                <span>
                  {item.name} x{item.qty}
                </span>
                <span>{formatMoney(item.price * item.qty, currency)}</span>
              </div>
            ))}
          </div>
        )}
        {bill.discount > 0 && (
          <div className="flex justify-between text-sm py-1">
            <span className="text-[var(--color-text-dim)]">Discount</span>
            <span>-{formatMoney(bill.discount, currency)}</span>
          </div>
        )}
        <div className="border-t border-[var(--color-border)] mt-2 pt-2 flex justify-between font-semibold">
          <span>Total</span>
          <span>{formatMoney(bill.total, currency)}</span>
        </div>
      </Card>

      {needsContact && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--color-text-faint)]">
            Whose credit should this go on? Same name reuses their existing profile.
          </p>
          <CustomerNameInput value={payerName} onChange={setPayerName} placeholder="Name" />
        </div>
      )}

      {error && <p className="text-xs text-[var(--color-danger)] -mt-2">{error}</p>}

      <button
        onClick={handleConfirm}
        className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
      >
        Full amount on credit
      </button>
    </div>
  );
}
