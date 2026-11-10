-- Production Co-operative Bank IPN processing metadata. Existing rows from
-- migration 008 are preserved and promoted into the controlled lifecycle.

ALTER TYPE payment_source ADD VALUE IF NOT EXISTS 'COOP_BANK_IPN';

ALTER TABLE coop_bank_ipn_events
  DROP CONSTRAINT IF EXISTS coop_bank_ipn_events_event_type_check;

ALTER TABLE coop_bank_ipn_events
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'COOP_BANK',
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS authentication_mode TEXT NOT NULL DEFAULT 'TOKEN',
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED',
  ADD COLUMN IF NOT EXISTS matched_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matched_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_method TEXT,
  ADD COLUMN IF NOT EXISTS match_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS manual_review_reason TEXT,
  ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_processing_error TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE coop_bank_ipn_events
SET idempotency_key = 'COOP_BANK:' || upper(trim(transaction_id)),
    processing_status = CASE WHEN status = 'Ignored' THEN 'PROCESSED' ELSE 'RECEIVED' END,
    reconciliation_status = CASE
      WHEN status = 'Reconciled' THEN 'MANUALLY_RECONCILED'
      WHEN status = 'Ignored' AND upper(event_type) = 'DEBIT' THEN 'IGNORED_DEBIT'
      ELSE 'PENDING_ALLOCATION'
    END,
    created_at = received_at,
    updated_at = received_at
WHERE idempotency_key IS NULL;

ALTER TABLE coop_bank_ipn_events
  ALTER COLUMN idempotency_key SET NOT NULL;

ALTER TABLE coop_bank_ipn_events
  ADD CONSTRAINT coop_bank_ipn_event_type_nonempty CHECK (length(trim(event_type)) > 0),
  ADD CONSTRAINT coop_bank_ipn_provider_check CHECK (provider = 'COOP_BANK'),
  ADD CONSTRAINT coop_bank_ipn_auth_mode_check CHECK (authentication_mode IN ('TOKEN', 'BASIC')),
  ADD CONSTRAINT coop_bank_ipn_processing_status_check CHECK (processing_status IN ('RECEIVED','VALIDATED','PROCESSING','PROCESSED','FAILED','QUARANTINED')),
  ADD CONSTRAINT coop_bank_ipn_reconciliation_status_check CHECK (reconciliation_status IN ('NOT_EVALUATED','MATCHED','UNMATCHED','AMBIGUOUS','IGNORED_DEBIT','PENDING_ALLOCATION','POSTED','MANUALLY_RECONCILED')),
  ADD CONSTRAINT coop_bank_ipn_match_confidence_check CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1));

CREATE UNIQUE INDEX IF NOT EXISTS uq_coop_bank_ipn_provider_transaction
  ON coop_bank_ipn_events(provider, transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_coop_bank_ipn_idempotency_key
  ON coop_bank_ipn_events(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_coop_bank_ipn_processing
  ON coop_bank_ipn_events(processing_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_coop_bank_ipn_reconciliation
  ON coop_bank_ipn_events(reconciliation_status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_coop_bank_ipn_payment_ref
  ON coop_bank_ipn_events(payment_ref);
CREATE INDEX IF NOT EXISTS idx_coop_bank_ipn_matched_member
  ON coop_bank_ipn_events(matched_member_id, received_at DESC);

CREATE TABLE IF NOT EXISTS coop_bank_event_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_event_id UUID REFERENCES coop_bank_ipn_events(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('SYSTEM','BANK_CALLBACK','USER')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  previous_status TEXT,
  new_status TEXT,
  reason TEXT,
  correlation_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coop_bank_event_audit_event
  ON coop_bank_event_audit(bank_event_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_coop_bank_raw_payload_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.raw_payload IS DISTINCT FROM OLD.raw_payload THEN
    RAISE EXCEPTION 'Co-op Bank raw_payload is immutable';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_coop_bank_raw_payload_immutable ON coop_bank_ipn_events;
CREATE TRIGGER trg_coop_bank_raw_payload_immutable
BEFORE UPDATE ON coop_bank_ipn_events
FOR EACH ROW EXECUTE FUNCTION prevent_coop_bank_raw_payload_update();

INSERT INTO schema_migrations (version, name)
VALUES ('010', 'coop_bank_ipn_pipeline')
ON CONFLICT (version) DO NOTHING;
