CREATE SEQUENCE public.claim_fence_mutation_probe;
CREATE TABLE public.piggyvest_staging_receipts (
  id uuid PRIMARY KEY,
  payload_sha256 text DEFAULT 'synthetic-sealed-digest',
  ciphertext text DEFAULT 'synthetic-ciphertext',
  nonce text DEFAULT 'synthetic-nonce',
  auth_tag text DEFAULT 'synthetic-auth-tag',
  key_version text DEFAULT 'staging-v1',
  status text NOT NULL,
  attempts integer NOT NULL,
  received_at timestamptz NOT NULL,
  next_attempt_at timestamptz,
  claim_token uuid,
  lease_expires_at timestamptz,
  last_error text
);
CREATE TABLE public.piggyvest_staging_replay_quarantine (
  receipt_id uuid PRIMARY KEY,
  reason text NOT NULL
);
INSERT INTO public.piggyvest_staging_receipts
  (id, status, attempts, received_at, next_attempt_at, claim_token, lease_expires_at, last_error)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'quarantined', 10, '2026-01-01Z',
    NULL, NULL, NULL, 'worker retryable'),
  ('20000000-0000-4000-8000-000000000002', 'quarantined', 4, '2026-01-02Z',
    NULL, NULL, NULL, 'worker retryable'),
  ('20000000-0000-4000-8000-000000000003', 'processing', 2, '2026-01-03Z',
    NULL, '30000000-0000-4000-8000-000000000001', '2100-01-01Z', NULL),
  ('20000000-0000-4000-8000-000000000004', 'quarantined', 1, '2026-01-04Z',
    '2100-01-01Z', NULL, NULL, 'worker retryable');
CREATE FUNCTION public.claim_fence_probe_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $probe$
BEGIN
  PERFORM pg_catalog.nextval('public.claim_fence_mutation_probe');
  RETURN NEW;
END;
$probe$;
CREATE TRIGGER claim_fence_probe BEFORE UPDATE ON public.piggyvest_staging_receipts
FOR EACH ROW EXECUTE FUNCTION public.claim_fence_probe_update();
CREATE OR REPLACE FUNCTION public.claim_piggyvest_staging_receipts(p_limit integer, p_lease_seconds integer)
RETURNS TABLE (receipt_id uuid, payload_sha256 text, ciphertext text, nonce text,
  auth_tag text, key_version text, claim_token uuid, attempts integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $function$__TEST_BODY__$function$;
