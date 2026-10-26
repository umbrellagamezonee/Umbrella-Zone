import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Card } from "./ui/Card";
import { useBillsStore } from "../store/useBillsStore";
import { useCustomersStore } from "../store/useCustomersStore";
import { CustomerNameInput } from "./ui/CustomerNameInput";
import { BillSlipBody, CustomerBillModal } from "./CustomerBill";
import { useSettingsStore } from "../store/useSettingsStore";
import { businessTotals, isRegularCustomer } from "../lib/billing";
import { normalizeName } from "../lib/customerName";
import { formatMoney, formatSessionLength, formatTime } from "../lib/format";
import type { Bill, PartPayment } from "../types";
import { Check, ArrowLeft, Repeat, Receipt, Gamepad2, UtensilsCrossed, Star, Printer, Banknote, Smartphone, BookUser } from "lucide-react";

// Two steps before payment is recorded:
//   1. the session at a glance - when it started, when it ended, how long, the bill - and one button: Bill
//   2. the Customer Bill (Gaming and Canteen apart) with the three ways to pay it: Cash, Account, Credit
type CheckoutStep = "select" | "bill" | "success";

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

const round2 = (n: number) => Math.round(n * 100) / 100;

// What a business actually gets from what was typed for it: cash and account
// can never be more than its bill, and whatever is left over is credit.
function settleOne(total: number, cashInput: string, upiInput: string): PartPayment {
  const cash = Math.min(Math.max(0, Number(cashInput) || 0), total);
  const upi = Math.min(Math.max(0, Number(upiInput) || 0), Math.max(0, total - cash));
  return { total, cash, upi, due: round2(total - cash - upi) };
}

export function Checkout({ bill, onDone, onCancel, onSettled, onRestart }: CheckoutProps) {
  const currency = useSettingsStore((s) => s.currencySymbol);
  const settlePayment = useBillsStore((s) => s.settlePayment);
  const bills = useBillsStore((s) => s.bills);
  const customers = useCustomersStore((s) => s.customers);
  const findOrCreateCustomer = useCustomersStore((s) => s.findOrCreateCustomer);
  const setRegular = useCustomersStore((s) => s.setRegular);
  const m = (n: number) => formatMoney(n, currency);

  const billCustomer = customers.find((c) => c.id === bill.customerId) ?? null;
  const isRegistered = !!billCustomer && !billCustomer.isWalkIn;

  const totals = businessTotals(bill);
  const hasGaming = totals.gaming > 0.005;
  const hasCanteen = totals.canteen > 0.005;

  const [step, setStep] = useState<CheckoutStep>("select");
  // All start at zero rather than pre-filled — nothing is assumed paid until
  // the cashier picks Cash, Account or Credit (or types an amount).
  const [gCash, setGCash] = useState("0");
  const [gUpi, setGUpi] = useState("0");
  const [cCash, setCCash] = useState("0");
  const [cUpi, setCUpi] = useState("0");
  const [choice, setChoice] = useState<"cash" | "upi" | "credit" | null>(null);
  const [touched, setTouched] = useState(false);
  const [creditName, setCreditName] = useState("");
  const [showSlip, setShowSlip] = useState(false);
  const [settled, setSettled] = useState<{
    gaming: PartPayment;
    canteen: PartPayment;
    creditTo: string | null;
  } | null>(null);
  const [error, setError] = useState("");

  const g = settleOne(totals.gaming, gCash, gUpi);
  const c = settleOne(totals.canteen, cCash, cUpi);
  const cashTotal = round2(g.cash + c.cash);
  const upiTotal = round2(g.upi + c.upi);
  const creditTotal = round2(g.due + c.due);

  // Who the credit would go to: the customer this bill is already for, or —
  // for a walk-in bill — whoever is picked below. Only regular customers get credit.
  const typed = normalizeName(creditName);
  const typedCustomer =
    !isRegistered && typed ? customers.find((x) => !x.isWalkIn && normalizeName(x.name) === typed) ?? null : null;
  const creditTarget = isRegistered ? billCustomer : typedCustomer;
  const targetIsRegular = isRegularCustomer(creditTarget, bills);
  const needsCredit = creditTotal > 0.005;
  const canConfirm = touched && (!needsCredit || (!!creditTarget && targetIsRegular));

  function quick(kind: "cash" | "upi" | "credit") {
    setGCash(kind === "cash" ? String(totals.gaming) : "0");
    setGUpi(kind === "upi" ? String(totals.gaming) : "0");
    setCCash(kind === "cash" ? String(totals.canteen) : "0");
    setCUpi(kind === "upi" ? String(totals.canteen) : "0");
    setChoice(kind);
    setTouched(true);
    setError("");
  }
  // typing an amount by hand is its own choice
  function typedAmount(set: (v: string) => void) {
    return (v: string) => {
      set(v);
      setChoice(null);
      setTouched(true);
    };
  }

  function handleConfirm() {
    if (step !== "bill") return;
    if (!touched) {
      setError("Pehle Cash, Account ya Credit chuno.");
      return;
    }
    if (needsCredit && !creditTarget) {
      setError("Credit ke liye regular customer ka naam chuno.");
      return;
    }
    if (needsCredit && !targetIsRegular) {
      setError("Ye regular customer nahi hai — pehle regular banao, ya poora cash / account lo.");
      return;
    }
    setError("");
    settlePayment(bill.id, {
      amountCash: cashTotal,
      amountUpi: upiTotal,
      customerId: needsCredit && creditTarget ? creditTarget.id : undefined,
      parts: { gaming: { cash: g.cash, upi: g.upi }, canteen: { cash: c.cash, upi: c.upi } },
    });
    onSettled?.();
    setSettled({ gaming: g, canteen: c, creditTo: needsCredit && creditTarget ? creditTarget.name : null });
    setStep("success");
  }

  const how = (p: PartPayment) =>
    [
      p.cash > 0.005 ? `Cash ${m(p.cash)}` : "",
      p.upi > 0.005 ? `Account ${m(p.upi)}` : "",
      p.due > 0.005 ? `Credit ${m(p.due)}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "—";

  if (step === "success" && settled) {
    const paidNow = round2(settled.gaming.cash + settled.gaming.upi + settled.canteen.cash + settled.canteen.upi);
    const credit = round2(settled.gaming.due + settled.canteen.due);
    return (
      <div className="space-y-4 py-4 text-center">
        <div className="mx-auto h-16 w-16 rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)] flex items-center justify-center">
          <Check size={32} />
        </div>
        <div>
          {paidNow > 0 ? (
            <p className="text-2xl font-bold">{m(paidNow)}</p>
          ) : (
            <p className="text-lg font-semibold">Poora credit par</p>
          )}
          <div className="mt-2 space-y-1 text-sm text-[var(--color-text-dim)]">
            {settled.gaming.total > 0.005 && (
              <p>
                <span className="font-medium">Gaming {m(settled.gaming.total)}:</span> {how(settled.gaming)}
              </p>
            )}
            {settled.canteen.total > 0.005 && (
              <p>
                <span className="font-medium">Canteen {m(settled.canteen.total)}:</span> {how(settled.canteen)}
              </p>
            )}
          </div>
          {credit > 0.005 && (
            <p className="text-sm text-[var(--color-warning)] mt-2">
              {m(credit)} added to {settled.creditTo ?? "customer"}'s credit
            </p>
          )}
        </div>
        <button
          onClick={onDone}
          className="w-full rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3"
        >
          Done
        </button>
        <button
          onClick={() => setShowSlip(true)}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-semibold py-3"
        >
          <Receipt size={15} /> Customer Bill
        </button>
        {onRestart && (
          <button
            onClick={onRestart}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-semibold py-3"
          >
            <Repeat size={15} /> Restart same session
          </button>
        )}
        {showSlip && <CustomerBillModal bill={bill} onClose={() => setShowSlip(false)} />}
      </div>
    );
  }

  // ---------------- step 2: the Customer Bill, and how it was paid ----------------
  if (step === "bill") {
    const panel = (
      label: string,
      Icon: typeof Gamepad2,
      p: PartPayment,
      cash: string,
      setCash: (v: string) => void,
      upi: string,
      setUpi: (v: string) => void
    ) => (
      <Card>
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Icon size={14} className="text-[var(--color-primary)]" /> {label}
          </span>
          <span className="text-sm font-semibold">{m(p.total)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-[var(--color-text-dim)]">
            Cash
            <input
              type="number"
              min={0}
              max={p.total}
              value={cash}
              onChange={(e) => typedAmount(setCash)(e.target.value)}
              className="mt-1 w-full text-right bg-[var(--color-surface-2)] rounded-lg px-2 py-1.5 text-sm outline-none"
            />
          </label>
          <label className="text-[11px] text-[var(--color-text-dim)]">
            Account (UPI)
            <input
              type="number"
              min={0}
              max={Math.max(0, p.total - p.cash)}
              value={upi}
              onChange={(e) => typedAmount(setUpi)(e.target.value)}
              className="mt-1 w-full text-right bg-[var(--color-surface-2)] rounded-lg px-2 py-1.5 text-sm outline-none"
            />
          </label>
        </div>
        <div className="flex justify-between text-xs mt-2">
          <span className="text-[var(--color-text-dim)]">Credit (baaki)</span>
          <span className={p.due > 0.005 ? "font-semibold text-[var(--color-warning)]" : "text-[var(--color-text-faint)]"}>
            {m(p.due)}
          </span>
        </div>
      </Card>
    );

    const option = (kind: "cash" | "upi" | "credit", label: string, Icon: typeof Banknote, tone: string) => (
      <button
        onClick={() => quick(kind)}
        className={
          "flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 py-4 font-semibold active:scale-95 transition-transform " +
          (choice === kind ? "border-[var(--color-primary)] " : "border-transparent ") +
          tone
        }
      >
        <Icon size={22} />
        <span className="text-sm">{label}</span>
      </button>
    );

    return (
      <div className="space-y-4">
        <button
          onClick={() => setStep("select")}
          className="flex items-center gap-1.5 text-sm text-[var(--color-text-dim)]"
        >
          <ArrowLeft size={14} /> Wapas
        </button>

        <BillSlipBody bill={bill} />

        <button
          onClick={() => setShowSlip(true)}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] font-semibold py-2.5 text-sm"
        >
          <Printer size={15} /> PDF / Print
        </button>

        <div>
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-dim)] mb-2">PAYMENT KAISE HUA?</p>
          <div className="grid grid-cols-3 gap-2">
            {option("cash", "Cash", Banknote, "bg-[var(--color-success)]/15 text-[var(--color-success)]")}
            {option("upi", "Account", Smartphone, "bg-[var(--color-primary)]/15 text-[var(--color-primary)]")}
            {option("credit", "Credit", BookUser, "bg-[var(--color-warning)]/15 text-[var(--color-warning)]")}
          </div>
        </div>

        <details className="rounded-xl border border-[var(--color-border)] px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--color-text-dim)]">
            Kuch cash, kuch credit? Amount alag-alag daalo
          </summary>
          <div className="space-y-3 pt-3">
            {hasGaming && panel("Gaming", Gamepad2, g, gCash, setGCash, gUpi, setGUpi)}
            {hasCanteen && panel("Canteen", UtensilsCrossed, c, cCash, setCCash, cUpi, setCUpi)}
            <p className="text-xs text-[var(--color-text-faint)]">
              Jo cash / account mein nahi diya wo credit mein jayega (sirf regular customer ko).
            </p>
          </div>
        </details>

        <div className="rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-xs flex flex-wrap justify-between gap-x-3 gap-y-1">
          <span>
            Cash <b>{m(cashTotal)}</b>
          </span>
          <span>
            Account <b>{m(upiTotal)}</b>
          </span>
          <span className={needsCredit ? "text-[var(--color-warning)]" : ""}>
            Credit <b>{m(creditTotal)}</b>
          </span>
        </div>

        {needsCredit && (
          <div className="space-y-2">
            {isRegistered ? (
              <p className="text-xs text-[var(--color-warning)]">
                {m(creditTotal)} {billCustomer?.name} ke credit mein jayega.
              </p>
            ) : (
              <>
                <p className="text-xs text-[var(--color-warning)]">
                  {m(creditTotal)} credit mein jayega — kis regular customer par?
                </p>
                <CustomerNameInput value={creditName} onChange={setCreditName} placeholder="Regular customer ka naam" />
                {typed && !typedCustomer && (
                  <button
                    onClick={() => {
                      const created = findOrCreateCustomer({ name: creditName.trim(), phone: "" });
                      setRegular(created.id, true);
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)]/15 text-[var(--color-primary)] text-sm font-medium py-2"
                  >
                    <Star size={14} /> "{creditName.trim()}" ko naya regular customer banao
                  </button>
                )}
              </>
            )}
            {creditTarget && !targetIsRegular && (
              <div className="rounded-xl bg-[var(--color-warning)]/10 p-3 space-y-2">
                <p className="text-xs">
                  <b>{creditTarget.name}</b> regular customer nahi hai. Credit sirf regular customer ko milta hai —
                  kabhi-kabhar aane wala customer paisa de kar jaata hai.
                </p>
                <button
                  onClick={() => setRegular(creditTarget.id, true)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold py-2"
                >
                  <Star size={14} /> {creditTarget.name} ko regular banao
                </button>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        {!touched && <p className="text-xs text-[var(--color-text-faint)]">Upar se Cash, Account ya Credit chuno.</p>}

        <button
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="w-full rounded-xl bg-[var(--color-primary)] disabled:opacity-40 text-white font-semibold py-3"
        >
          {needsCredit ? `Confirm — ${m(creditTotal)} credit mein` : "Confirm payment"}
        </button>

        {showSlip && <CustomerBillModal bill={bill} onClose={() => setShowSlip(false)} />}
      </div>
    );
  }

  // ---------------- step 1: the session at a glance ----------------
  const minutes = Math.round(bill.tableChargeMinutes);
  const startedAt = bill.createdAt - bill.tableChargeMinutes * 60000;
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
          <>
            {minutes > 0 ? (
              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <div className="rounded-xl bg-[var(--color-surface-2)] py-2">
                  <p className="text-[10px] text-[var(--color-text-dim)]">SHURU</p>
                  <p className="text-sm font-bold">{formatTime(startedAt)}</p>
                </div>
                <div className="rounded-xl bg-[var(--color-surface-2)] py-2">
                  <p className="text-[10px] text-[var(--color-text-dim)]">KHATAM</p>
                  <p className="text-sm font-bold">{formatTime(bill.createdAt)}</p>
                </div>
                <div className="rounded-xl bg-[var(--color-surface-2)] py-2">
                  <p className="text-[10px] text-[var(--color-text-dim)]">TIME</p>
                  <p className="text-sm font-bold">{formatSessionLength(minutes)}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--color-text-faint)] mb-2">Time record nahi hua</p>
            )}
            <div className="flex justify-between text-sm py-1">
              <span className="flex items-center gap-1.5 text-[var(--color-text-dim)]">
                <Gamepad2 size={13} /> Gaming
              </span>
              <span>{m(bill.tableCharge)}</span>
            </div>
          </>
        )}
        {(bill.canteenCharge > 0 || bill.canteenItems.length > 0) && (
          <div className="flex justify-between text-sm py-1">
            <span className="flex items-center gap-1.5 text-[var(--color-text-dim)]">
              <UtensilsCrossed size={13} /> Canteen
            </span>
            <span>{m(bill.canteenCharge)}</span>
          </div>
        )}
        {bill.canteenItems.length > 0 && (
          <div className="pb-1 space-y-0.5">
            {bill.canteenItems.map((item, idx) => (
              <div key={idx} className="flex justify-between text-xs text-[var(--color-text-faint)] pl-2">
                <span>
                  {item.name} x{item.qty}
                </span>
                <span>{m(item.price * item.qty)}</span>
              </div>
            ))}
          </div>
        )}
        {bill.discount > 0 && (
          <div className="flex justify-between text-sm py-1">
            <span className="text-[var(--color-text-dim)]">Discount</span>
            <span>-{m(bill.discount)}</span>
          </div>
        )}
        <div className="border-t border-[var(--color-border)] mt-2 pt-2 flex justify-between font-semibold">
          <span>Total</span>
          <span>{m(bill.total)}</span>
        </div>
      </Card>

      <button
        onClick={() => setStep("bill")}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] text-white font-semibold py-3.5 text-base"
      >
        <Receipt size={18} /> Bill
      </button>
    </div>
  );
}
