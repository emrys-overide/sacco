-- Roll back only the metadata introduced by migration 010. Existing bank
-- events and their migration-008 fields remain intact.
DROP TRIGGER IF EXISTS trg_coop_bank_raw_payload_immutable ON coop_bank_ipn_events;
DROP FUNCTION IF EXISTS prevent_coop_bank_raw_payload_update();
DROP TABLE IF EXISTS coop_bank_event_audit;
DROP INDEX IF EXISTS idx_coop_bank_ipn_matched_member;
DROP INDEX IF EXISTS idx_coop_bank_ipn_payment_ref;
DROP INDEX IF EXISTS idx_coop_bank_ipn_reconciliation;
DROP INDEX IF EXISTS idx_coop_bank_ipn_processing;
DROP INDEX IF EXISTS uq_coop_bank_ipn_idempotency_key;
DROP INDEX IF EXISTS uq_coop_bank_ipn_provider_transaction;
ALTER TABLE coop_bank_ipn_events
  DROP CONSTRAINT IF EXISTS coop_bank_ipn_match_confidence_check,
  DROP CONSTRAINT IF EXISTS coop_bank_ipn_reconciliation_status_check,
  DROP CONSTRAINT IF EXISTS coop_bank_ipn_processing_status_check,
  DROP CONSTRAINT IF EXISTS coop_bank_ipn_auth_mode_check,
  DROP CONSTRAINT IF EXISTS coop_bank_ipn_provider_check,
  DROP CONSTRAINT IF EXISTS coop_bank_ipn_event_type_nonempty,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS posted_at,
  DROP COLUMN IF EXISTS processed_at,
  DROP COLUMN IF EXISTS last_processing_error,
  DROP COLUMN IF EXISTS duplicate_count,
  DROP COLUMN IF EXISTS processing_attempts,
  DROP COLUMN IF EXISTS manual_review_reason,
  DROP COLUMN IF EXISTS match_confidence,
  DROP COLUMN IF EXISTS match_method,
  DROP COLUMN IF EXISTS matched_vehicle_id,
  DROP COLUMN IF EXISTS matched_member_id,
  DROP COLUMN IF EXISTS reconciliation_status,
  DROP COLUMN IF EXISTS processing_status,
  DROP COLUMN IF EXISTS authentication_mode,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS provider;
-- PostgreSQL enum values are intentionally retained because removing an enum
-- value is destructive when ledger rows already use it.
