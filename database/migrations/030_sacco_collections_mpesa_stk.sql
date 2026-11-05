-- Migration: 030_sacco_collections_mpesa_stk.sql
-- Description: Table for Daraja M-Pesa STK Push transactions with strict idempotency

CREATE TABLE IF NOT EXISTS sacco_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('SAVINGS', 'LOAN_REPAYMENT')),
    account_reference VARCHAR(50) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    phone_number VARCHAR(15) NOT NULL,
    merchant_request_id VARCHAR(100) NOT NULL,
    checkout_request_id VARCHAR(100) NOT NULL UNIQUE,
    mpesa_receipt_number VARCHAR(50) UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'RESOLVED_RECONCILED', 'EXPIRED_UNPAID')),
    result_code INTEGER,
    result_description TEXT,
    ledger_entry_id UUID REFERENCES ledger_entries(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sacco_tx_status_created ON sacco_transactions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sacco_tx_checkout ON sacco_transactions(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_sacco_tx_member ON sacco_transactions(member_id);
