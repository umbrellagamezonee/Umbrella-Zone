# Credit Hisaab (daily PDF + Excel)

Double-click `run.cmd` (ya `toolscredit-reportun.cmd`). Ye shop ka taaza data padhta hai (sirf padhta hai, kuch badalta nahi)
aur `outCredit-Hisaab-<date>.pdf` aur `.xlsx` banata hai.

Numbers app ke Excel export wale hi functions se aate hain (`src/lib/billing.ts`: creditHisaab, creditPendingReport), isliye
app ke "Credit hisaab" / "Credit baaki - kiska" sheets se kabhi alag nahi honge.
