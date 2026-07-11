-- SACCO production initial schema
-- Target database: PostgreSQL / Supabase-compatible SQL

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum TEXT
);

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('Chairman','Secretary','Treasurer','Auditor','Accountant','Member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE member_status AS ENUM ('Active','Inactive','Pending','Suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vehicle_status AS ENUM ('Active','Maintenance','Suspended','Exited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM ('Credit','Debit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('Pending','Reconciled','Unmatched','Rejected','Duplicate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_source AS ENUM ('Manual','DarajaWebhook','SystemAdjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_type AS ENUM ('DailyContribution','RegistrationFee','ManagementFee','OfficeExpenses','PettyCash','Penalty','Utilities','Equipment','LoanRepay','Savings','Shares','StageTicket','LegalFee','Other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE till_type AS ENUM ('VehicleTill','UtilityTill','None');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_entry_status AS ENUM ('Posted','Reversed','Void','PendingReview');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reconciliation_match_method AS ENUM ('MemberID','VehiclePlate','PhoneNumber','ManualAssignment','None');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE loan_status AS ENUM ('Active','Cleared','Defaulted','WrittenOff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS sacco_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_name TEXT NOT NULL DEFAULT 'Sowetamu Sacco',
  default_currency CHAR(3) NOT NULL DEFAULT 'KES',
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  role user_role NOT NULL,
  password_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_number TEXT UNIQUE,
  full_name TEXT NOT NULL,
  national_id TEXT UNIQUE,
  phone TEXT,
  email TEXT,
  status member_status NOT NULL DEFAULT 'Active',
  date_registered DATE,
  initial_loan_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (initial_loan_amount >= 0),
  loan_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (loan_balance >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_name TEXT NOT NULL UNIQUE,
  origin TEXT,
  destination TEXT,
  stage_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number TEXT NOT NULL UNIQUE,
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  route_id UUID REFERENCES routes(id) ON DELETE SET NULL,
  vehicle_type TEXT,
  capacity INTEGER CHECK (capacity > 0),
  driver_name TEXT,
  driver_phone TEXT,
  status vehicle_status NOT NULL DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mpesa_tills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  till_type till_type NOT NULL UNIQUE,
  business_short_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  default_account_type account_type NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (till_type <> 'None')
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date DATE NOT NULL,
  entry_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  transaction_type transaction_type NOT NULL,
  account_type account_type NOT NULL,
  till_type till_type NOT NULL DEFAULT 'None',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  reference_code TEXT,
  description TEXT NOT NULL,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  source payment_source NOT NULL DEFAULT 'Manual',
  status ledger_entry_status NOT NULL DEFAULT 'Posted',
  is_reversed BOOLEAN NOT NULL DEFAULT FALSE,
  reversal_of UUID REFERENCES ledger_entries(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reversal_of IS NULL OR reversal_of <> id)
);

CREATE TABLE IF NOT EXISTS mpesa_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trans_id TEXT NOT NULL UNIQUE,
  bill_ref_number TEXT,
  business_short_code TEXT NOT NULL,
  msisdn TEXT,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  payer_name TEXT,
  till_type till_type NOT NULL DEFAULT 'UtilityTill',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  transaction_time TIMESTAMPTZ NOT NULL,
  status payment_status NOT NULL DEFAULT 'Pending',
  match_method reconciliation_match_method NOT NULL DEFAULT 'None',
  matched_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  matched_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  ledger_entry_id UUID UNIQUE REFERENCES ledger_entries(id) ON DELETE SET NULL,
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reconciled_at TIMESTAMPTZ,
  reconciled_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS daily_vehicle_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_date DATE NOT NULL,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  operation_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  entrance_fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  loan_repay_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  savings_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  stage_ticket_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  legal_fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(record_date, vehicle_id)
);

CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  principal_amount NUMERIC(14,2) NOT NULL CHECK (principal_amount > 0),
  interest_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  issue_date DATE NOT NULL,
  due_date DATE,
  status loan_status NOT NULL DEFAULT 'Active',
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  ledger_entry_id UUID UNIQUE REFERENCES ledger_entries(id) ON DELETE SET NULL,
  repayment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS savings_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS share_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL UNIQUE REFERENCES members(id) ON DELETE CASCADE,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date DATE NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  paid_to TEXT,
  payment_reference TEXT,
  ledger_entry_id UUID UNIQUE REFERENCES ledger_entries(id) ON DELETE SET NULL,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monthly_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_month DATE NOT NULL UNIQUE,
  total_credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  mpesa_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  cash_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS monthly_closing_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_closing_id UUID NOT NULL REFERENCES monthly_closings(id) ON DELETE CASCADE,
  account_type account_type NOT NULL,
  total_credit NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_debit NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  UNIQUE(monthly_closing_id, account_type)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  auth_provider TEXT,
  firebase_uid TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_entry_date ON ledger_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_member_id ON ledger_entries(member_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_vehicle_id ON ledger_entries(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_type ON ledger_entries(account_type);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_reference_code ON ledger_entries(reference_code);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_till_type ON ledger_entries(till_type);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_status ON ledger_entries(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_entries_reference_code_not_null
  ON ledger_entries(reference_code)
  WHERE reference_code IS NOT NULL AND reference_code <> '';

CREATE INDEX IF NOT EXISTS idx_mpesa_payments_status ON mpesa_payments(status);
CREATE INDEX IF NOT EXISTS idx_mpesa_payments_bill_ref_number ON mpesa_payments(bill_ref_number);
CREATE INDEX IF NOT EXISTS idx_mpesa_payments_transaction_time ON mpesa_payments(transaction_time);
CREATE INDEX IF NOT EXISTS idx_mpesa_payments_till_type ON mpesa_payments(till_type);

CREATE INDEX IF NOT EXISTS idx_daily_vehicle_records_date ON daily_vehicle_records(record_date);
CREATE INDEX IF NOT EXISTS idx_loans_member_id ON loans(member_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_table, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_audit_logs_firebase_uid ON audit_logs(firebase_uid);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sacco_settings_updated_at ON sacco_settings;
CREATE TRIGGER trg_sacco_settings_updated_at
BEFORE UPDATE ON sacco_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_members_updated_at ON members;
CREATE TRIGGER trg_members_updated_at
BEFORE UPDATE ON members
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_vehicles_updated_at ON vehicles;
CREATE TRIGGER trg_vehicles_updated_at
BEFORE UPDATE ON vehicles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_mpesa_tills_updated_at ON mpesa_tills;
CREATE TRIGGER trg_mpesa_tills_updated_at
BEFORE UPDATE ON mpesa_tills
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ledger_entries_updated_at ON ledger_entries;
CREATE TRIGGER trg_ledger_entries_updated_at
BEFORE UPDATE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_daily_vehicle_records_updated_at ON daily_vehicle_records;
CREATE TRIGGER trg_daily_vehicle_records_updated_at
BEFORE UPDATE ON daily_vehicle_records
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_loans_updated_at ON loans;
CREATE TRIGGER trg_loans_updated_at
BEFORE UPDATE ON loans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE VIEW v_member_financial_balances AS
SELECT
  m.id AS member_id,
  m.member_number,
  m.full_name,
  COALESCE(SUM(CASE WHEN le.account_type = 'Shares' AND le.transaction_type = 'Credit' AND le.status = 'Posted' THEN le.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN le.account_type = 'Shares' AND le.transaction_type = 'Debit' AND le.status = 'Posted' THEN le.amount ELSE 0 END), 0) AS shares_balance,
  COALESCE(SUM(CASE WHEN le.account_type = 'Savings' AND le.transaction_type = 'Credit' AND le.status = 'Posted' THEN le.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN le.account_type = 'Savings' AND le.transaction_type = 'Debit' AND le.status = 'Posted' THEN le.amount ELSE 0 END), 0) AS savings_balance,
  COALESCE(SUM(CASE WHEN le.transaction_type = 'Credit' AND le.status = 'Posted' THEN le.amount ELSE 0 END), 0) AS total_credits,
  COALESCE(SUM(CASE WHEN le.transaction_type = 'Debit' AND le.status = 'Posted' THEN le.amount ELSE 0 END), 0) AS total_debits
FROM members m
LEFT JOIN ledger_entries le ON le.member_id = m.id
GROUP BY m.id, m.member_number, m.full_name;

CREATE OR REPLACE VIEW v_daily_till_summary AS
SELECT
  le.entry_date,
  le.till_type,
  le.account_type,
  COALESCE(SUM(CASE WHEN le.transaction_type = 'Credit' AND le.status = 'Posted' THEN le.amount ELSE 0 END), 0) AS total_credit,
  COALESCE(SUM(CASE WHEN le.transaction_type = 'Debit' AND le.status = 'Posted' THEN le.amount ELSE 0 END), 0) AS total_debit,
  COUNT(*) FILTER (WHERE le.status = 'Posted') AS posted_entries
FROM ledger_entries le
GROUP BY le.entry_date, le.till_type, le.account_type;

CREATE OR REPLACE VIEW v_unreconciled_mpesa_payments AS
SELECT
  id,
  trans_id,
  bill_ref_number,
  business_short_code,
  till_type,
  payer_name,
  msisdn,
  amount,
  transaction_time,
  status,
  match_method,
  received_at
FROM mpesa_payments
WHERE status IN ('Pending','Unmatched');

INSERT INTO schema_migrations(version, name)
VALUES ('001', 'initial_production_schema')
ON CONFLICT (version) DO NOTHING;
