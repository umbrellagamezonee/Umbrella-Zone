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

  const billCustomer = customers.find((c) => c.id === bill.customerId) ?? null;
  const isRegistered = !!billCustomer && !billCustomer.isWalkIn;

  const [step, setStep] = useState<CheckoutStep>("select");
  const [cashInput, setCashInput] = useState(bill.total.toFixed(2));
  const [accountInput, setAccountInput] = useState("0");
  const [payerName, setPayerName] = useState(
    billCustomer && !billCustomer.isWalkIn ? billCustomer.name : ""
  );
  const [settled, setSettled] = useState<{
    amountCash: number;
    amountUpi: number;
    amountDue: number;
    creditTo: string | null;
  } | null>(null);
  const [error, setError] = useState("");

  const cash = Math.min(Math.max(0, Number(cashInput) || 0), bill.total);
  const account = Math.min(Math.max(0, Number(accountInput) || 0), Math.max(0, bill.total - cash));
  const creditPortion = Math.round((bill.total - cash - account) * 100) / 100;

  function finalize(cashAmt: number, accountAmt: number) {
    const due = Math.round((bill.total - cashAmt - accountAmt) * 100) / 100;
    if (due > 0 && !isRegistered && !payerName.trim()) {
      setError("Enter a name so this balance can be tracked.");
      return;
    }
    setError("");
    let creditCustomerId = bill.customerId;
    let creditCustomerName = billCustomer?.name ?? null;

    if (due > 0 && !isRegistered) {
      // Matches an existing customer by name so the same person's credit
      // keeps landing on one profile instead of splintering into duplicates.
      const c = findOrCreateCustomer({ name: payerName.trim(), phone: "" });
      creditCustomerId = c.id;
      creditCustomerName = c.name;
    }

    settlePayment(bill.id, {
      amountCash: cashAmt,
      amountUpi: accountAmt,
      customerId: due > 0 ? creditCustomerId ?? undefined : undefined,
    });
    onSettled?.();
    setSettled({
      amountCash: cashAmt,
      amountUpi: accountAmt,
      amountDue: due,
      creditTo: due > 0 ? creditCustomerName : null,
    });
    setStep("success");
  }

  function handlePayNow() {
    finalize(cash, account);
  }

  function handleFullCredit() {
    setCashInput("0");
    setAccountInput("0");
    finalize(0, 0);
  }

  if (step === "success" && settled) {
    const paidNow = settled.amountCash + settled.amountUpi;
    return (
      <div className="space-y-4 py-4 text-center">
        <div className="mx-auto h-16 w-16 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] flex items-center justify-center">
          <Check size={32} />
        </div>
        <div>
          {paidNow > 0 && <p className="text-2xl font-bold">{formatMoney(paidNow, currency)}</p>}
          <p className="text-sm text-[var(--color-text-dim)] mt-1">
            {settled.amountCash > 0 && settled.amountUpi > 0
              ? `${formatMoney(settled.amountCash, currency)} cash + ${formatMoney(settled.amountUpi, currency)} account`
              : settled.amountUpi > 0
              ? "Received via Account"
              : settled.amountCash > 0
              ? "Received via Cash"
              : "Fully on credit"}
          </p>
          {settled.amountDue > 0 && (
            <p className="text-sm text-[var(--color-warning)] mt-2">
              {formatMoney(settled.amountDue, currency)} added to {settled.creditTo ?? "customer"}'s credit
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

      <p className="text-xs text-[var(--color-text-faint)]">
        Already got cash or Account (UPI) from them? Enter it below — only what's left unpaid goes on credit.
      </p>
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--color-text-dim)]">Cash</span>
        <input
          type="number"
          min={0}
          max={bill.total}
          value={cashInput}
          onChange={(e) => setCashInput(e.target.value)}
          className="w-24 text-right bg-[var(--color-surface-2)] rounded-lg px-2 py-1.5 text-sm outline-none"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--color-text-dim)]">Account (UPI)</span>
        <input
          type="number"
          min={0}
          max={Math.max(0, bill.total - cash)}
          value={accountInput}
          onChange={(e) => setAccountInput(e.target.value)}
          className="w-24 text-right bg-[var(--color-surface-2)] rounded-lg px-2 py-1.5 text-sm outline-none"
        />
      </div>

      {creditPortion > 0 && (
        <div className="space-y-2 -mt-2">
          <p className="text-xs text-[var(--color-warning)]">
            {formatMoney(creditPortion, currency)} will be added to credit unless paid in full above.
          </p>
          {!isRegistered && (
            <CustomerNameInput
              value={payerName}
              onChange={setPayerName}
              placeholder="Name — only needed for the credit part"
            />
          )}
        </div>
      )}

      {error && <p className="text-xs text-[var(--color-danger)] -mt-2">{error}</p>}

      <button
        onClick={handlePayNow}
        className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
      >
        Confirm payment
      </button>

      <button
        onClick={handleFullCredit}
        className="w-full rounded-xl bg-[var(--color-warning)]/15 text-[var(--color-warning)] font-semibold py-2.5 text-sm"
      >
        Full amount on credit
      </button>
    </div>
  );
}
