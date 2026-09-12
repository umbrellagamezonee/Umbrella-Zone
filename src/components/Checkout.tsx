import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Card } from "./ui/Card";
import { useBillsStore } from "../store/useBillsStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { CustomerNameInput } from "./ui/CustomerNameInput";
import { useSettingsStore } from "../store/useSettingsStore";
import { formatMoney } from "../lib/format";
import type { Bill } from "../types";
import { QRCodeSVG } from "qrcode.react";
import { Check, ArrowLeft, Repeat } from "lucide-react";

type CheckoutStep = "select" | "upi-qr" | "success";

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
  const storeName = useSettingsStore((s) => s.storeName);
  const upiId = useSettingsStore((s) => s.upiId);
  const settlePayment = useBillsStore((s) => s.settlePayment);
  const customers = useCustomersStore((s) => s.customers);
  const findOrCreateCustomer = useCustomersStore((s) => s.findOrCreateCustomer);
  const adjustCredit = useCustomersStore((s) => s.adjustCredit);

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
  const amountPaid = cash + account;
  const creditPortion = Math.round((bill.total - amountPaid) * 100) / 100;
  const needsContact = !isRegistered;

  function finalize(cashAmt: number, accountAmt: number) {
    const paidNow = cashAmt + accountAmt;
    const due = Math.round((bill.total - paidNow) * 100) / 100;
    let creditCustomerId = bill.customerId;
    let creditCustomerName = billCustomer?.name ?? null;

    if (due > 0 && !isRegistered) {
      if (!payerName.trim()) {
        setError("Enter a name so this balance can be tracked.");
        return;
      }
      // Matches an existing customer by name so the same person's credit
      // keeps landing on one profile instead of splintering into duplicates.
      const c = findOrCreateCustomer({ name: payerName.trim(), phone: "" });
      creditCustomerId = c.id;
      creditCustomerName = c.name;
    }

    setError("");
    const updated = settlePayment(bill.id, { amountCash: cashAmt, amountUpi: accountAmt });
    if (updated && due > 0 && creditCustomerId) {
      adjustCredit(creditCustomerId, due);
    }
    onSettled?.();
    setSettled({
      amountCash: cashAmt,
      amountUpi: accountAmt,
      amountDue: due,
      creditTo: due > 0 ? creditCustomerName : null,
    });
    setStep("success");
  }

  function handleConfirm() {
    if (needsContact && creditPortion > 0 && !payerName.trim()) {
      setError("Enter a name so this balance can be tracked.");
      return;
    }
    setError("");
    if (account > 0 && upiId) setStep("upi-qr");
    else finalize(cash, account);
  }

  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    storeName
  )}&am=${account.toFixed(2)}&cu=INR&tn=${encodeURIComponent(bill.tableName ?? "Bill")}`;

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

  if (step === "upi-qr") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStep("select")}
            className="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--color-surface-2)]"
          >
            <ArrowLeft size={14} />
          </button>
          <p className="text-sm text-[var(--color-text-dim)]">Scan to pay</p>
        </div>
        <Card className="flex flex-col items-center gap-3 py-6">
          <div className="rounded-xl bg-white p-3">
            <QRCodeSVG value={upiUri} size={200} />
          </div>
          <p className="text-2xl font-bold">{formatMoney(account, currency)}</p>
          <p className="text-xs text-[var(--color-text-dim)]">Pay to {storeName}</p>
        </Card>
        <button
          onClick={() => finalize(cash, account)}
          className="w-full rounded-xl bg-[var(--color-success)]/15 text-[var(--color-success)] font-semibold py-3"
        >
          Payment received
        </button>
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
        <p className="text-xs text-[var(--color-warning)] -mt-2">
          {formatMoney(creditPortion, currency)} will be added to{" "}
          {isRegistered ? `${billCustomer!.name}'s` : "their"} credit.
        </p>
      )}

      {needsContact && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--color-text-faint)]">
            Only needed if you're leaving any balance unpaid. Same name reuses their existing
            credit profile.
          </p>
          <CustomerNameInput value={payerName} onChange={setPayerName} placeholder="Name" />
        </div>
      )}

      {error && <p className="text-xs text-[var(--color-danger)] -mt-2">{error}</p>}

      <button
        onClick={handleConfirm}
        className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
      >
        Confirm payment
      </button>
      {account > 0 && !upiId && (
        <p className="text-xs text-[var(--color-text-faint)] text-center -mt-2">
          Add a UPI ID in Settings → Store Settings to show a scannable QR code.
        </p>
      )}
      <button
        onClick={() => {
          setCashInput("0");
          setAccountInput("0");
          if (needsContact && !payerName.trim()) {
            setError("Enter a name so this balance can be tracked.");
            return;
          }
          setError("");
          finalize(0, 0);
        }}
        className="w-full rounded-xl bg-[var(--color-warning)]/15 text-[var(--color-warning)] font-semibold py-2.5 text-sm"
      >
        Full amount on credit
      </button>
    </div>
  );
}
