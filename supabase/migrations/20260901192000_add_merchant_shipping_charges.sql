-- Idempotent merchant-wallet funding ledger for provider shipment booking.
CREATE TABLE IF NOT EXISTS public.merchant_shipping_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  shipping_quote_id uuid NOT NULL REFERENCES public.shipping_quotes(id),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','provider_submitting','booked','refunded','needs_reconciliation')),
  currency text NOT NULL CHECK (currency = 'NGN'),
  charged_amount numeric(12,2) NOT NULL CHECK (charged_amount > 0),
  provider_cost numeric(12,2),
  platform_margin numeric(12,2),
  attempt_token_digest text NOT NULL,
  debit_transaction_id uuid REFERENCES public.wallet_transactions(id),
  refund_transaction_id uuid REFERENCES public.wallet_transactions(id),
  shipment_id uuid REFERENCES public.shipments(id),
  provider_reference text,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  provider_submitting_at timestamptz,
  completed_at timestamptz,
  refunded_at timestamptz,
  UNIQUE(order_id, shipping_quote_id)
);
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS provider_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS platform_margin numeric(12,2);
DO $$ BEGIN
  ALTER TABLE public.shipments ADD CONSTRAINT shipments_provider_cost_nonnegative CHECK (provider_cost IS NULL OR provider_cost >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shipments ADD CONSTRAINT shipments_platform_margin_nonnegative CHECK (platform_margin IS NULL OR platform_margin >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.merchant_shipping_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_shipping_charges_owner_read ON public.merchant_shipping_charges;
CREATE POLICY merchant_shipping_charges_owner_read ON public.merchant_shipping_charges
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.merchants AS m
      WHERE m.id = merchant_shipping_charges.merchant_id
        AND m.user_id = auth.uid()
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.merchant_shipping_charges FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge(
  p_order_id uuid, p_quote_id uuid, p_attempt_token text
) RETURNS TABLE(charge_id uuid, charged_amount numeric, balance_after numeric, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_order public.orders%ROWTYPE; v_quote public.shipping_quotes%ROWTYPE;
  v_wallet public.merchant_wallets%ROWTYPE; v_existing public.merchant_shipping_charges%ROWTYPE; v_tx uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR SHARE;
  IF NOT FOUND
     OR NOT EXISTS (
       SELECT 1
       FROM public.merchants AS m
       WHERE m.id = v_order.merchant_id
         AND m.user_id = auth.uid()
     )
     OR v_order.shipping_funding_source IS DISTINCT FROM 'merchant_wallet' THEN
    RAISE EXCEPTION 'order_not_owned' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_quote FROM public.shipping_quotes WHERE id=p_quote_id AND merchant_id=v_order.merchant_id AND provider='GIGL' AND currency='NGN' AND expires_at > now();
  IF NOT FOUND OR v_order.selected_quote_id IS DISTINCT FROM p_quote_id OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
     OR v_order.shipping_provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_order.shipping_platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_order.shipping_pricing_version IS DISTINCT FROM v_quote.pricing_version THEN RAISE EXCEPTION 'quote_not_eligible' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('merchant-shipping:'||v_order.merchant_id||':'||p_order_id,0));
  SELECT * INTO v_existing FROM public.merchant_shipping_charges WHERE order_id=p_order_id AND shipping_quote_id=p_quote_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.status = 'reserved' THEN
      UPDATE public.merchant_shipping_charges
         SET attempt_token_digest = pg_catalog.encode(extensions.digest(p_attempt_token,'sha256'),'hex'), updated_at = now()
       WHERE id = v_existing.id;
    END IF;
    SELECT available_balance INTO balance_after FROM public.merchant_wallets WHERE merchant_id=v_order.merchant_id;
    RETURN QUERY SELECT v_existing.id,v_existing.charged_amount,balance_after,v_existing.status; RETURN;
  END IF;
  SELECT * INTO v_wallet FROM public.merchant_wallets WHERE merchant_id=v_order.merchant_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.available_balance,0) < v_quote.price THEN RAISE EXCEPTION 'MERCHANT_WALLET_INSUFFICIENT' USING ERRCODE='P0001'; END IF;
  UPDATE public.merchant_wallets SET available_balance=available_balance-v_quote.price, updated_at=now() WHERE id=v_wallet.id RETURNING available_balance INTO balance_after;
  INSERT INTO public.wallet_transactions(wallet_id,merchant_id,type,amount,balance_after,source_type,source_id,description,status)
    VALUES(v_wallet.id,v_order.merchant_id,'debit',v_quote.price,balance_after,'gigl_shipping',p_order_id,'GIGL shipping reservation','completed') RETURNING id INTO v_tx;
  INSERT INTO public.merchant_shipping_charges(merchant_id,order_id,shipping_quote_id,currency,charged_amount,provider_cost,platform_margin,attempt_token_digest,debit_transaction_id)
    VALUES(v_order.merchant_id,p_order_id,p_quote_id,v_quote.currency,v_quote.price,v_quote.provider_cost,v_quote.platform_margin,pg_catalog.encode(extensions.digest(p_attempt_token,'sha256'),'hex'),v_tx)
    RETURNING id,status INTO charge_id,status;
  RETURN QUERY SELECT charge_id,v_quote.price,balance_after,status;
END; $$;

CREATE OR REPLACE FUNCTION public.begin_merchant_shipping_charge_submission(p_charge_id uuid,p_attempt_token text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v text; d text := pg_catalog.encode(extensions.digest(p_attempt_token,'sha256'),'hex');
BEGIN
  SELECT c.status INTO v
  FROM public.merchant_shipping_charges AS c
  WHERE c.id = p_charge_id
    AND EXISTS (
      SELECT 1
      FROM public.merchants AS m
      WHERE m.id = c.merchant_id
        AND m.user_id = auth.uid()
    )
    AND c.attempt_token_digest = d
  FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'charge_not_owned' USING ERRCODE='42501'; END IF;
  IF v='reserved' THEN UPDATE public.merchant_shipping_charges SET status='provider_submitting',provider_submitting_at=now(),updated_at=now() WHERE id=p_charge_id RETURNING status INTO v; END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.complete_merchant_shipping_charge(p_charge_id uuid,p_attempt_token text,p_shipment_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v text; d text := pg_catalog.encode(extensions.digest(p_attempt_token,'sha256'),'hex');
BEGIN
 SELECT c.status INTO v
 FROM public.merchant_shipping_charges AS c
 WHERE c.id = p_charge_id
   AND EXISTS (
     SELECT 1
     FROM public.merchants AS m
     WHERE m.id = c.merchant_id
       AND m.user_id = auth.uid()
   )
   AND c.attempt_token_digest = d
 FOR UPDATE;
 IF v IS NULL THEN RAISE EXCEPTION 'charge_not_owned' USING ERRCODE='42501'; END IF;
 IF v = 'provider_submitting' THEN UPDATE public.merchant_shipping_charges SET status='booked',shipment_id=p_shipment_id,completed_at=now(),updated_at=now() WHERE id=p_charge_id RETURNING status INTO v; END IF;
 RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.refund_merchant_shipping_charge(p_charge_id uuid,p_attempt_token text,p_reason_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE c public.merchant_shipping_charges%ROWTYPE; b numeric; tx uuid;
BEGIN
 SELECT msc.* INTO c
 FROM public.merchant_shipping_charges AS msc
 WHERE msc.id = p_charge_id
   AND EXISTS (
     SELECT 1
     FROM public.merchants AS m
     WHERE m.id = msc.merchant_id
       AND m.user_id = auth.uid()
   )
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'charge_not_owned' USING ERRCODE='42501'; END IF;
 IF c.attempt_token_digest <> pg_catalog.encode(extensions.digest(p_attempt_token,'sha256'),'hex') THEN RAISE EXCEPTION 'charge_not_owned' USING ERRCODE='42501'; END IF;
 IF c.status='refunded' THEN RETURN c.status; END IF;
 IF c.status IN ('refunded','booked','needs_reconciliation') THEN RETURN c.status; END IF;
 IF c.status NOT IN ('reserved','provider_submitting') THEN RETURN c.status; END IF;
 UPDATE public.merchant_wallets SET available_balance=available_balance+c.charged_amount,updated_at=now() WHERE merchant_id=c.merchant_id RETURNING available_balance INTO b;
 INSERT INTO public.wallet_transactions(wallet_id,merchant_id,type,amount,balance_after,source_type,source_id,description,status)
 SELECT id,c.merchant_id,'refund',c.charged_amount,b,'gigl_shipping',c.order_id,'GIGL shipping reservation refund','completed' FROM public.merchant_wallets WHERE merchant_id=c.merchant_id RETURNING id INTO tx;
 UPDATE public.merchant_shipping_charges SET status='refunded',refund_transaction_id=tx,failure_code=p_reason_code,refunded_at=now(),updated_at=now() WHERE id=c.id;
 RETURN 'refunded';
END; $$;

CREATE OR REPLACE FUNCTION public.mark_merchant_shipping_charge_for_reconciliation(p_charge_id uuid,p_attempt_token text,p_reason_code text,p_provider_reference text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v text; d text := pg_catalog.encode(extensions.digest(p_attempt_token,'sha256'),'hex');
BEGIN
  SELECT c.status INTO v
  FROM public.merchant_shipping_charges AS c
  WHERE c.id = p_charge_id
    AND EXISTS (
      SELECT 1
      FROM public.merchants AS m
      WHERE m.id = c.merchant_id
        AND m.user_id = auth.uid()
    )
    AND c.attempt_token_digest = d
  FOR UPDATE;
 IF v IS NULL THEN RAISE EXCEPTION 'charge_not_owned' USING ERRCODE='42501'; END IF;
 IF v IN ('reserved','provider_submitting') THEN UPDATE public.merchant_shipping_charges SET status='needs_reconciliation',failure_code=p_reason_code,provider_reference=p_provider_reference,updated_at=now() WHERE id=p_charge_id RETURNING status INTO v; END IF;
 RETURN v;
END; $$;

REVOKE ALL ON FUNCTION public.reserve_merchant_shipping_charge(uuid,uuid,text), public.begin_merchant_shipping_charge_submission(uuid,text), public.complete_merchant_shipping_charge(uuid,text,uuid), public.refund_merchant_shipping_charge(uuid,text,text), public.mark_merchant_shipping_charge_for_reconciliation(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_shipping_charge(uuid,uuid,text), public.begin_merchant_shipping_charge_submission(uuid,text), public.complete_merchant_shipping_charge(uuid,text,uuid), public.refund_merchant_shipping_charge(uuid,text,text), public.mark_merchant_shipping_charge_for_reconciliation(uuid,text,text,text) TO authenticated;
