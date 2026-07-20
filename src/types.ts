/**
 * Domain types for Matatu Sacco Management System (v1.0 Blueprint)
 */

export type UserRole = 'Chairman' | 'Secretary' | 'Treasurer' | 'Auditor' | 'Member' | 'Accountant';

export type AccountStatus = 'PendingActivation' | 'Active' | 'Suspended' | 'Disabled' | 'Rejected' | 'Locked';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string;
  accountStatus?: AccountStatus;
  linkedMemberId?: string;
}

export interface Member {
  id: string;
  name: string;
  /** Trusted email recorded by an officer; used with phone and name to gate member account creation. */
  email?: string;
  membershipNumber?: string;
  idNumber: string;
  phoneNumber: string;
  status: 'Active' | 'Inactive' | 'Pending';
  dateRegistered: string;
  vehicleAssigned?: string; // Vehicle registration number
  sharesAmount: number;     // Future capability prepared
  savingsAmount: number;    // Future capability prepared
  loanBalance?: number;     // Outstanding member loan, reduced by daily loan repayments
  initialLoanAmount?: number;
}

export interface DriverAssignment {
  id: string;
  vehicleId: string;
  vehiclePlate?: string;
  driverName: string;
  driverPhone?: string;
  startDateTime: string;
  endDateTime?: string;
  status: 'Active' | 'Closed';
  reason?: string;
}

export interface MemberLoanSummary {
  id: string;
  principalAmount: number;
  outstandingBalance: number;
  issueDate: string;
  dueDate?: string;
  status: string;
  interestRate?: number;
  totalPayable?: number;
  notes?: string;
  repayments: Array<{ id: string; repaymentDate: string; amount: number }>;
}

export type LoanStatus = 'Applied' | 'Approved' | 'Active' | 'Cleared' | 'Defaulted' | 'Rejected' | 'WrittenOff';

export interface Vehicle {
  id: string;
  plateNumber: string; // e.g. KCJ 402X
  ownerId: string;     // Member ID
  ownerName: string;
  driverName: string;
  driverPhone: string;
  route: string;       // e.g. "Nairobi - Thika (Route 237)"
  status: 'Active' | 'Maintenance' | 'Suspended';
  capacity: 7 | 14 | 33 | 50;
}

export type TillType = 'VehicleTill' | 'UtilityTill' | 'None';
export type VehicleClass = 'Nissan' | 'Sienta' | 'Member Contribution';
export type TransactionType = 'Credit' | 'Debit';
export type TransactionCategory = 'Daily Contribution' | 'Savings Contribution' | 'Registration Fee' | 'Management Fee' | 'Office Expenses' | 'Petty Cash' | 'Penalty' | 'Utilities' | 'Equipment';

export interface Transaction {
  id: string;
  timestamp: string;
  memberId?: string;
  memberName?: string;
  vehiclePlate?: string;
  description: string;
  refCode: string; // Bank reference or cash voucher code
  type: TransactionType;
  category: TransactionCategory;
  amount: number;
  recorderName: string;
  tillNumber: TillType;
  vehicleClass?: VehicleClass;
  operationAmount?: number;
  entranceFee?: number;
  loanRepay?: number;
  savingsContribution?: number;
  sTicket?: number;
  legalFee?: number;
  expenseDeduction?: number;
  grossAmount?: number;
  reversalOf?: string;
  reversedAt?: string;
  reversedBy?: string;
}

export type PaymentStatus = 'Pending' | 'Reconciled' | 'Unmatched' | 'Rejected' | 'Duplicate';
export type PaymentSource = 'Manual' | 'Webhook';
export type PaymentMatchMethod = 'Member ID' | 'Vehicle Plate' | 'Phone Number' | 'Manual Assignment' | 'None';

export type CoopBankEventType = 'CREDIT' | 'DEBIT' | string;
export type CoopBankProcessingStatus = 'RECEIVED' | 'VALIDATED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'QUARANTINED';
export type CoopBankReconciliationStatus = 'NOT_EVALUATED' | 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS' | 'IGNORED_DEBIT' | 'PENDING_ALLOCATION' | 'POSTED' | 'MANUALLY_RECONCILED';

/** A durable Co-operative Bank B2B/IPN event. Raw bank payloads remain server-only. */
export interface CoopBankEvent {
  id: string;
  transactionId: string;
  paymentRef?: string;
  accountNumber: string;
  amount: number;
  currency: string;
  eventType: CoopBankEventType;
  narration: string;
  customerMemoLine1?: string;
  customerMemoLine2?: string;
  customerMemoLine3?: string;
  bookedBalance?: number;
  clearedBalance?: number;
  exchangeRate?: number;
  postingDate?: string;
  valueDate?: string;
  transactionDate?: string;
  processingStatus: CoopBankProcessingStatus;
  reconciliationStatus: CoopBankReconciliationStatus;
  matchedMemberId?: string;
  matchedMemberName?: string;
  matchedVehicleId?: string;
  matchedVehiclePlate?: string;
  ledgerEntryId?: string;
  matchMethod?: string;
  matchConfidence?: number;
  manualReviewReason?: string;
  processingAttempts: number;
  duplicateCount: number;
  lastProcessingError?: string;
  receivedAt: string;
  processedAt?: string;
  reconciledAt?: string;
}

export interface PaymentRecord {
  id: string;
  timestamp: string;
  source: PaymentSource;
  status: PaymentStatus;
  refCode: string;
  amount: number;
  tillNumber: Exclude<TillType, 'None'>;
  category: TransactionCategory;
  accountReference: string;
  destinationAccount?: string;
  payerName: string;
  payerPhone: string;
  memberId?: string;
  memberName?: string;
  vehiclePlate?: string;
  matchMethod: PaymentMatchMethod;
  transactionId?: string;
  note?: string;
  rawPayload?: unknown;
}

export interface MemberPortalData {
  member: Member;
  vehicles: Vehicle[];
  driverAssignments: DriverAssignment[];
  transactions: Transaction[];
  payments: PaymentRecord[];
  loans: MemberLoanSummary[];
}

export interface TargetCollection {
  name: string;
  current: number;
  target: number;
  unit: string;
}
