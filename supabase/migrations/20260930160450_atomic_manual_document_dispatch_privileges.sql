-- Least-privilege grants for the atomic dispatch marker, split from
-- 20260930160400_atomic_manual_document_dispatch.sql (300-line rule).
-- Applies immediately after it; the service role is the only executor.
-- Safe predeploy: matches 60400 (no live callers change).

REVOKE ALL ON FUNCTION public.mark_manual_document_dispatch_started(uuid, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, timestamptz, date, jsonb, uuid, uuid, text, text, integer, jsonb, text, text, text, text, text, text, text, integer, jsonb, integer, jsonb, text, text, text, jsonb, text, text, text, numeric, text, text, text, text, text, timestamptz, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_manual_document_dispatch_started(uuid, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text, text, timestamptz, date, jsonb, uuid, uuid, text, text, integer, jsonb, text, text, text, text, text, text, text, integer, jsonb, integer, jsonb, text, text, text, jsonb, text, text, text, numeric, text, text, text, text, text, timestamptz, text, text, jsonb)
  TO service_role;
