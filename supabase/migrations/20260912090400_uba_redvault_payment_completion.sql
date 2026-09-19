CREATE TABLE private.uba_redvault_payment_attempts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES private.uba_redvault_applications(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL CHECK (merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid),
  reference text NOT NULL UNIQUE CHECK (reference ~ '^[A-Za-z0-9.=\\-]{1,100}$'),
  quote_payload_hash text NOT NULL CHECK (quote_payload_hash ~ '^[0-9a-f]{64}$'),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  currency text NOT NULL CHECK (currency = 'NGN'),
  state text NOT NULL CHECK (state IN ('created','initialized','indeterminate','captured_held','approved','superseded','void')),
  provider_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), initialized_at timestamptz, captured_at timestamptz
);
CREATE UNIQUE INDEX uba_redvault_live_attempt_per_application ON private.uba_redvault_payment_attempts(application_id)
  WHERE state IN ('created','initialized','indeterminate');
CREATE INDEX uba_redvault_payment_attempts_order_id_idx ON private.uba_redvault_payment_attempts(order_id);
ALTER TABLE private.uba_redvault_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.uba_redvault_payment_attempts FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY redvault_attempt_no_direct_access ON private.uba_redvault_payment_attempts AS RESTRICTIVE FOR ALL TO anon, authenticated, service_role USING (false) WITH CHECK (false);

CREATE TABLE private.uba_redvault_refunds (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(), attempt_id uuid NOT NULL REFERENCES private.uba_redvault_payment_attempts(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL, amount_kobo bigint NOT NULL CHECK (amount_kobo > 0), state text NOT NULL CHECK (state IN ('requested','processing','failed','processed')),
  provider_reference text, created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  UNIQUE(attempt_id, idempotency_key)
);
CREATE INDEX uba_redvault_refunds_attempt_id_idx ON private.uba_redvault_refunds(attempt_id);
ALTER TABLE private.uba_redvault_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.uba_redvault_refunds FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY redvault_refund_no_direct_access ON private.uba_redvault_refunds AS RESTRICTIVE FOR ALL TO anon, authenticated, service_role USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION private.reject_unapproved_redvault_paid_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.payment_method = 'uba_redvault' AND NEW.payment_status = 'paid'
    AND NOT EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts a WHERE a.order_id = NEW.id AND a.state = 'approved') THEN
    RAISE EXCEPTION 'redvault_paid_transition_requires_approved_attempt';
  END IF;
  RETURN NEW;
END; $$;
ALTER FUNCTION private.reject_unapproved_redvault_paid_transition() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_unapproved_redvault_paid_transition() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER reject_unapproved_redvault_paid_transition BEFORE UPDATE OF payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.reject_unapproved_redvault_paid_transition();
