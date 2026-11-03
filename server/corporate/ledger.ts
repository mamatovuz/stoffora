import { randomUUID } from "node:crypto";
import type { CorporateLedgerEntry, CorporateTransaction, CorporateTransactionType } from "../../lib/corporate/types";
import type { Database } from "../../lib/types";

const accounts: Record<CorporateTransactionType, [string, string]> = {
  INCOME: ["CASH", "REVENUE"],
  EXPENSE: ["EXPENSE", "CASH"],
  INVESTMENT: ["CASH", "INVESTMENT_LIABILITY"],
  INVESTMENT_RETURN: ["INVESTMENT_LIABILITY", "CASH"],
  PROFIT_DISTRIBUTION: ["RETAINED_EARNINGS", "PARTICIPANT_PAYABLE"],
  RESERVE_ALLOCATION: ["RETAINED_EARNINGS", "DEVELOPMENT_RESERVE"],
  PAYOUT: ["PARTICIPANT_PAYABLE", "CASH"],
  REFUND: ["REFUND_EXPENSE", "CASH"],
  ADJUSTMENT: ["ADJUSTMENT_DEBIT", "ADJUSTMENT_CREDIT"],
  REVERSAL: ["REVERSAL_DEBIT", "REVERSAL_CREDIT"],
};

export function postLedger(db: Database, transaction: CorporateTransaction) {
  if (db.corporateLedgerEntries.some((e) => e.transactionId === transaction.id)) throw Object.assign(new Error("Bu tranzaksiya ledgerga oldin yozilgan."), { status: 409 });
  const [debit, credit] = accounts[transaction.type];
  const now = new Date().toISOString();
  const rows: CorporateLedgerEntry[] = [
    { id: randomUUID(), companyId: transaction.companyId, transactionId: transaction.id, account: debit, side: "DEBIT", amountMinor: transaction.amountMinor, currency: transaction.currency, createdAt: now },
    { id: randomUUID(), companyId: transaction.companyId, transactionId: transaction.id, account: credit, side: "CREDIT", amountMinor: transaction.amountMinor, currency: transaction.currency, createdAt: now },
  ];
  db.corporateLedgerEntries.push(...rows);
  transaction.status = "POSTED";
  return rows;
}

export function accountBalance(db: Database, companyId: string, account: string) {
  return db.corporateLedgerEntries.filter((e) => e.companyId === companyId && e.account === account).reduce((sum, e) => sum + (e.side === "DEBIT" ? e.amountMinor : -e.amountMinor), 0);
}

export function ledgerBalanced(db: Database, companyId: string) {
  const debit = db.corporateLedgerEntries.filter((e) => e.companyId === companyId && e.side === "DEBIT").reduce((s, e) => s + e.amountMinor, 0);
  const credit = db.corporateLedgerEntries.filter((e) => e.companyId === companyId && e.side === "CREDIT").reduce((s, e) => s + e.amountMinor, 0);
  return { debit, credit, balanced: debit === credit };
}
