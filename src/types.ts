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
  repayments: Array<{ id: string; repaymentDate: string; amount: number }>;
}

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
  refCode: string; // M-Pesa or Cash voucher code
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

export interface MPesaConfig {
  shortcode: string;
  callbackUrl: string;
  mode: 'sandbox' | 'production';
  stkPushEnabled: boolean;
  hasConsumerKey?: boolean;
  hasConsumerSecret?: boolean;
  credentialsConfigured?: boolean;
}
