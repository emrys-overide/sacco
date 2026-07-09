/**
 * Domain types for Matatu Sacco Management System (v1.0 Blueprint)
 */

export type UserRole = 'Chairman' | 'Secretary' | 'Treasurer' | 'Auditor' | 'Member' | 'Accountant';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string;
}

export interface Member {
  id: string;
  name: string;
  idNumber: string;
  phoneNumber: string;
  status: 'Active' | 'Inactive' | 'Pending';
  dateRegistered: string;
  vehicleAssigned?: string; // Vehicle registration number
  sharesAmount: number;     // Future capability prepared
  savingsAmount: number;    // Future capability prepared
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
  capacity: 14 | 33 | 50;
}

export type TillType = 'VehicleTill' | 'UtilityTill' | 'None';
export type TransactionType = 'Credit' | 'Debit';
export type TransactionCategory = 'Daily Contribution' | 'Registration Fee' | 'Management Fee' | 'Office Expenses' | 'Petty Cash' | 'Penalty' | 'Utilities' | 'Equipment';

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
