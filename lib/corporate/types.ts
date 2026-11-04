export type CorporateRole = "FOUNDER" | "CO_FOUNDER" | "CEO" | "INVESTOR" | "FINANCE_MANAGER" | "CORPORATE_ADMIN" | "OBSERVER";
export type CorporateStatus = "ACTIVE" | "INVITED" | "DISABLED";

export interface CorporateParticipant {
  id: string;
  companyId: string;
  userId?: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  login?: string;
  passwordHash?: string;
  shareBps?: number;
  role: CorporateRole;
  status: CorporateStatus;
  joinedAt: string;
  lastActiveAt?: string;
  termsAcceptedAt?: string;
  termsVersion?: string;
  lastLoginAt?: string;
}

export interface LegalOwnershipRecord {
  id: string;
  companyId: string;
  participantId?: string;
  holderName: string;
  basis: string;
  basisDocumentId?: string;
  shareBps: number;
  status: "PENDING_DOCUMENTATION" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED";
  effectiveAt?: string;
  createdAt: string;
  createdBy: string;
}

export interface EconomicInterestVersion {
  id: string;
  companyId: string;
  version: number;
  title: string;
  status: "DRAFT" | "UNDER_REVIEW" | "ACTIVE" | "SUPERSEDED";
  effectiveAt?: string;
  agreementVersionId?: string;
  allocations: { id: string; participantId?: string; subject: string; kind: "PARTICIPANT" | "RESERVE"; shareBps: number }[];
  createdAt: string;
  createdBy: string;
  approvedAt?: string;
}

export type CorporateTransactionType = "INCOME" | "EXPENSE" | "INVESTMENT" | "INVESTMENT_RETURN" | "PROFIT_DISTRIBUTION" | "RESERVE_ALLOCATION" | "PAYOUT" | "REFUND" | "ADJUSTMENT" | "REVERSAL";
export interface CorporateTransaction {
  id: string;
  companyId: string;
  idempotencyKey: string;
  type: CorporateTransactionType;
  category: string;
  amountMinor: number;
  currency: "UZS";
  description: string;
  occurredAt: string;
  status: "DRAFT" | "PENDING" | "POSTED" | "REVERSED";
  createdAt: string;
  createdBy: string;
  approvedBy?: string;
  reversalOf?: string;
  documentIds?: string[];
}

export interface CorporateLedgerEntry {
  id: string;
  companyId: string;
  transactionId: string;
  account: string;
  side: "DEBIT" | "CREDIT";
  amountMinor: number;
  currency: "UZS";
  createdAt: string;
}

export interface ProfitDistribution {
  id: string;
  companyId: string;
  periodFrom: string;
  periodTo: string;
  grossIncomeMinor: number;
  expensesMinor: number;
  obligationsMinor: number;
  distributableMinor: number;
  economicVersionId: string;
  items: { allocationId: string; participantId?: string; subject: string; kind: "PARTICIPANT" | "RESERVE"; shareBps: number; amountMinor: number }[];
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "POSTED";
  idempotencyKey: string;
  createdAt: string;
  createdBy: string;
  postedTransactionId?: string;
}

export interface ParticipantWalletEntry {
  id: string;
  companyId: string;
  participantId: string;
  sourceType: "PROFIT" | "WITHDRAWAL" | "ADJUSTMENT";
  sourceId: string;
  amountMinor: number;
  status: "AVAILABLE" | "RESERVED" | "PAID" | "REVERSED";
  createdAt: string;
}

export interface WithdrawalRequest {
  id: string;
  companyId: string;
  participantId: string;
  amountMinor: number;
  currency: "UZS";
  payoutMask?: string;
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "PROCESSING" | "PAID" | "CANCELLED" | "FAILED";
  reason?: string;
  createdAt: string;
  createdBy: string;
  decidedAt?: string;
  decidedBy?: string;
  paidAt?: string;
  payoutDocumentId?: string;
}

export interface ReserveExpense {
  id: string;
  companyId: string;
  amountMinor: number;
  purpose: string;
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "PAID";
  documentIds?: string[];
  createdAt: string;
  createdBy: string;
  transactionId?: string;
}

export interface CorporateInvestment {
  id: string;
  companyId: string;
  participantId?: string;
  investorName: string;
  amountMinor: number;
  currency: "UZS";
  kind: "LOAN" | "PROFIT_LINKED" | "EQUITY_INTENT" | "OTHER";
  terms: string;
  status: "PROPOSED" | "UNDER_REVIEW" | "ACCEPTED" | "FUNDED" | "CLOSED" | "REJECTED";
  agreementId?: string;
  returnedMinor: number;
  createdAt: string;
  createdBy: string;
}

export interface CorporateAgreement {
  id: string;
  companyId: string;
  title: string;
  type: "FOUNDER" | "CO_FOUNDER" | "INVESTOR" | "ECONOMIC_INTEREST" | "INVESTMENT" | "POLICY" | "OTHER";
  status: "DRAFT" | "UNDER_REVIEW" | "PENDING_ACCEPTANCE" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "ARCHIVED";
  versions: { id: string; version: number; content: string; fileKey?: string; sha256: string; status: "DRAFT" | "FINAL"; createdAt: string; createdBy: string; effectiveAt?: string }[];
  assignedParticipantIds: string[];
  createdAt: string;
  createdBy: string;
}

export interface AgreementAcceptance {
  id: string;
  companyId: string;
  agreementId: string;
  versionId: string;
  participantId: string;
  acceptedAt: string;
  withdrawalDeadline: string;
  status: "ACCEPTED" | "WITHDRAWAL_PENDING" | "WITHDRAWN" | "REJECTED";
}

export interface AgreementWithdrawalRequest {
  id: string;
  companyId: string;
  acceptanceId: string;
  participantId: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface CorporateApproval {
  id: string;
  companyId: string;
  actionType: string;
  entityType: string;
  entityId: string;
  initiatorParticipantId: string;
  requiredRoles: CorporateRole[];
  decisions: { participantId: string; decision: "APPROVED" | "REJECTED"; reason?: string; at: string }[];
  status: "DRAFT" | "PENDING" | "PARTIALLY_APPROVED" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";
  amountMinor?: number;
  createdAt: string;
  expiresAt: string;
}

export interface CorporateAuditEntry {
  id: string;
  companyId: string;
  participantId?: string;
  actorUserId: string;
  actorName: string;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  approvalId?: string;
  result: "SUCCESS" | "DENIED" | "FAILED";
  createdAt: string;
}
