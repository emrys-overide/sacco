-- Add opening and outstanding loan balances to existing member registers.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS initial_loan_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (initial_loan_amount >= 0),
  ADD COLUMN IF NOT EXISTS loan_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (loan_balance >= 0);
