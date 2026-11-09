-- Owner-only "Baci pays shipping" mode for GIG bookings.
-- The platform owner flags a merchant in a private, service-only table (set it
-- from the SQL editor as postgres; no API, RLS policy or UI can write it).
-- For flagged merchants reserve_merchant_shipping_charge records a
-- funding_source = 'platform' charge and debits no wallet; refunds credit
-- nothing back. Every guard for normal merchants (Paystack direct-split
-- exposure, funding-source trigger, prepaid checks) is unchanged.

CREATE TABLE IF NOT EXISTS private.platform_funded_gigl_merchants (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.platform_funded_gigl_merchants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.platform_funded_gigl_merchants
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.merchant_shipping_charges
  ADD COLUMN IF NOT EXISTS funding_source text NOT NULL DEFAULT 'merchant_wallet';
DO $$ BEGIN
  ALTER TABLE public.merchant_shipping_charges
    ADD CONSTRAINT merchant_shipping_charges_funding_source_check
    CHECK (funding_source IN ('merchant_wallet', 'platform'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.merchant_shipping_charges
    ADD CONSTRAINT merchant_shipping_charges_platform_no_wallet_movement
    CHECK (
      funding_source <> 'platform'
      OR (debit_transaction_id IS NULL AND refund_transaction_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.get_gigl_shipping_funding_mode(p_merchant_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required' USING ERRCODE = '22023';
  END IF;
  IF (SELECT auth.uid()) IS NULL OR NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
  ) THEN
    RAISE EXCEPTION 'gigl_shipping_funding_mode_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN EXISTS (
    SELECT 1 FROM private.platform_funded_gigl_merchants AS flag
    WHERE flag.merchant_id = p_merchant_id AND flag.enabled
  ) THEN 'platform' ELSE 'merchant_wallet' END;
END;
$$;
ALTER FUNCTION public.get_gigl_shipping_funding_mode(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_gigl_shipping_funding_mode(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_gigl_shipping_funding_mode(uuid)
  TO authenticated;

-- merchant_shipping_charges is column-granted to authenticated (20260903128000);
-- the bound-quote lookup reads the payer of an existing reservation. The
-- column carries no money values, so exposing it leaks no economics.
GRANT SELECT (funding_source) ON TABLE public.merchant_shipping_charges
  TO authenticated;
