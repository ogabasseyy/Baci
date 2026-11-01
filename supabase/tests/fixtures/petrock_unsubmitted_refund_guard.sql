-- Minimal isolated empty-database fixture. NEVER load into an existing database.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.petrock_orders (
  id uuid PRIMARY KEY, status text NOT NULL,
  provider_attempt_started_at timestamptz, provider_order_id text,
  provider_status text, customer_message text, failure_reason text,
  reconcile_lease_token uuid, reconcile_lease_until timestamptz,
  updated_at timestamptz
);
CREATE TABLE public.petrock_order_events (
  order_id uuid, event_type text, from_status text, to_status text, metadata jsonb
);
CREATE TABLE public.test_refund_receipts (order_id uuid PRIMARY KEY, reason text);
-- Stub only the wallet boundary; test the migrated function/locking unchanged.
CREATE FUNCTION public.refund_wallet_for_remediation(uuid, text) RETURNS boolean
LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO public.test_refund_receipts VALUES ($1,$2) ON CONFLICT DO NOTHING;
  UPDATE public.petrock_orders SET status='refunded' WHERE id=$1;
  RETURN true;
END $$;
CREATE FUNCTION public.fail_petrock_remediation_before_acceptance(uuid,text,text)
RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION public.fail_petrock_remediation_before_acceptance(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_petrock_remediation_before_acceptance(uuid,text,text) TO service_role;
