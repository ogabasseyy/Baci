-- Resolve the ambiguous OUT-parameter assignment in the original reserve RPC.
CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge(
  p_order_id uuid, p_quote_id uuid, p_attempt_token text
)
RETURNS TABLE(charge_id uuid, charged_amount numeric, balance_after numeric, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote public.shipping_quotes%ROWTYPE;
  v_attestation public.shipping_quote_attestations%ROWTYPE;
  v_wallet public.merchant_wallets%ROWTYPE;
  v_existing public.merchant_shipping_charges%ROWTYPE;
  v_new_charge public.merchant_shipping_charges%ROWTYPE;
  v_tx uuid;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=v_order.merchant_id AND m.user_id=auth.uid()) OR v_order.shipping_funding_source IS DISTINCT FROM 'merchant_wallet' THEN RAISE EXCEPTION 'order_not_owned' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('merchant-shipping:'||v_order.merchant_id||':'||p_order_id,0));
  SELECT * INTO v_existing FROM public.merchant_shipping_charges WHERE order_id=p_order_id AND shipping_quote_id=p_quote_id FOR UPDATE;
  SELECT * INTO v_quote FROM public.shipping_quotes WHERE id=p_quote_id AND merchant_id=v_order.merchant_id AND provider='GIGL' AND currency='NGN';
  SELECT * INTO v_attestation FROM public.shipping_quote_attestations WHERE quote_id=p_quote_id;
  IF v_quote.id IS NULL OR v_attestation.quote_id IS NULL OR v_order.selected_quote_id IS DISTINCT FROM p_quote_id OR v_order.shipping_provider IS DISTINCT FROM 'GIGL' OR v_order.shipping_provider_cost IS DISTINCT FROM v_quote.provider_cost OR v_order.shipping_platform_margin IS DISTINCT FROM v_quote.platform_margin OR v_order.shipping_pricing_version IS DISTINCT FROM v_quote.pricing_version OR v_quote.session_id IS DISTINCT FROM p_order_id::text OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1' OR v_quote.is_station_pickup OR (v_existing.id IS NULL AND v_quote.expires_at <= now()) OR v_attestation.order_id IS DISTINCT FROM p_order_id OR v_attestation.merchant_id IS DISTINCT FROM v_order.merchant_id OR v_attestation.price IS DISTINCT FROM v_quote.price OR v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost OR v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin OR v_attestation.currency IS DISTINCT FROM v_quote.currency OR v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version OR v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at OR v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup OR v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id OR v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request THEN RAISE EXCEPTION 'quote_not_eligible' USING ERRCODE='22023'; END IF;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'reserved' THEN UPDATE public.merchant_shipping_charges SET attempt_token_digest=pg_catalog.encode(extensions.digest(p_attempt_token,'sha256'),'hex'),updated_at=now() WHERE id=v_existing.id; END IF;
    SELECT available_balance INTO balance_after FROM public.merchant_wallets WHERE merchant_id=v_order.merchant_id;
    RETURN QUERY SELECT v_existing.id,v_existing.charged_amount,balance_after,v_existing.status; RETURN;
  END IF;
  SELECT * INTO v_wallet FROM public.merchant_wallets WHERE merchant_id=v_order.merchant_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.available_balance,0) < v_quote.price THEN RAISE EXCEPTION 'MERCHANT_WALLET_INSUFFICIENT' USING ERRCODE='P0001'; END IF;
  UPDATE public.merchant_wallets SET available_balance=available_balance-v_quote.price,updated_at=now() WHERE id=v_wallet.id RETURNING available_balance INTO balance_after;
  INSERT INTO public.wallet_transactions(wallet_id,merchant_id,type,amount,balance_after,source_type,source_id,description,status)
    VALUES(v_wallet.id,v_order.merchant_id,'debit',v_quote.price,balance_after,'gigl_shipping',p_order_id,'GIGL shipping reservation','completed') RETURNING id INTO v_tx;
  INSERT INTO public.merchant_shipping_charges(merchant_id,order_id,shipping_quote_id,currency,charged_amount,provider_cost,platform_margin,attempt_token_digest,debit_transaction_id)
    VALUES(v_order.merchant_id,p_order_id,p_quote_id,v_quote.currency,v_quote.price,v_quote.provider_cost,v_quote.platform_margin,pg_catalog.encode(extensions.digest(p_attempt_token,'sha256'),'hex'),v_tx)
    RETURNING * INTO v_new_charge;
  RETURN QUERY SELECT v_new_charge.id,v_quote.price,balance_after,v_new_charge.status;
END; $$;
REVOKE ALL ON FUNCTION public.reserve_merchant_shipping_charge(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_shipping_charge(uuid,uuid,text) TO authenticated;

-- Preserve the newest provider assignment when an existing merchant row is reused.
CREATE OR REPLACE FUNCTION public.persist_merchant_wallet_payment_account(p_request_id uuid,p_merchant_id uuid,p_account_number text,p_account_name text,p_bank_name text,p_currency text,p_provider_account_id text DEFAULT NULL,p_provider_customer_code text DEFAULT NULL)
RETURNS public.merchant_wallet_payment_accounts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.merchant_wallet_payment_accounts; v_request public.merchant_wallet_funding_account_requests;
BEGIN
  IF coalesce((SELECT auth.role()),'') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_currency <> 'NGN' OR p_account_number !~ '^[0-9]{10,20}$' THEN RAISE EXCEPTION 'invalid_account' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_request FROM public.merchant_wallet_funding_account_requests WHERE id=p_request_id AND merchant_id=p_merchant_id FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'funding_request_not_found' USING ERRCODE='P0001'; END IF;
  IF v_request.status = 'fulfilled' THEN
    SELECT * INTO v_row FROM public.merchant_wallet_payment_accounts WHERE request_id=p_request_id;
    IF v_row.account_number=p_account_number AND v_row.account_name IS NOT DISTINCT FROM p_account_name AND v_row.bank_name IS NOT DISTINCT FROM p_bank_name AND v_row.currency=p_currency AND v_row.provider_account_id IS NOT DISTINCT FROM p_provider_account_id AND v_row.provider_customer_code IS NOT DISTINCT FROM p_provider_customer_code THEN RETURN v_row; END IF;
    RAISE EXCEPTION 'conflicting_assignment_replay' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.merchant_wallet_payment_accounts(merchant_id,request_id,account_number,account_name,bank_name,currency,status,provider_account_id,provider_customer_code)
  VALUES(p_merchant_id,p_request_id,p_account_number,p_account_name,p_bank_name,'NGN','active',p_provider_account_id,p_provider_customer_code)
  ON CONFLICT (merchant_id, provider) WHERE status IN ('active','pending') DO UPDATE SET request_id=EXCLUDED.request_id,account_number=EXCLUDED.account_number,account_name=EXCLUDED.account_name,bank_name=EXCLUDED.bank_name,provider_account_id=EXCLUDED.provider_account_id,provider_customer_code=EXCLUDED.provider_customer_code,status='active',updated_at=now()
  RETURNING * INTO v_row;
  UPDATE public.merchant_wallet_funding_account_requests SET status='fulfilled' WHERE id=p_request_id AND merchant_id=p_merchant_id AND status='pending';
  RETURN v_row;
END; $$;
REVOKE ALL ON FUNCTION public.persist_merchant_wallet_payment_account(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_merchant_wallet_payment_account(uuid,uuid,text,text,text,text,text,text) TO service_role;

-- Fail closed: only an explicit refund is terminal enough to permit replacement.
CREATE OR REPLACE FUNCTION private.block_active_shipping_charge_quote_replacement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.selected_quote_id IS NOT DISTINCT FROM OLD.selected_quote_id THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_shipping_charges AS c WHERE c.order_id=OLD.id AND c.status IS DISTINCT FROM 'refunded') THEN
    RAISE EXCEPTION 'active_shipping_charge_quote_replacement_blocked' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END; $$;
