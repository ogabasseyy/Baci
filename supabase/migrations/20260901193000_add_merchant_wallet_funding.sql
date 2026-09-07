BEGIN;
CREATE TABLE IF NOT EXISTS public.merchant_wallet_funding_account_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  consented_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','failed','expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_wallet_one_active_request ON public.merchant_wallet_funding_account_requests(merchant_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS public.merchant_wallet_payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.merchant_wallet_funding_account_requests(id), provider text NOT NULL DEFAULT 'paystack', provider_account_id text,
  provider_customer_code text, account_number text NOT NULL CHECK (account_number ~ '^[0-9]{10,20}$'), account_name text, bank_name text,
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'), status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','disabled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_wallet_active_provider_account ON public.merchant_wallet_payment_accounts(provider, account_number) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS merchant_wallet_provider_merchant ON public.merchant_wallet_payment_accounts(merchant_id, provider) WHERE status IN ('active','pending');
ALTER TABLE public.merchant_wallet_funding_account_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_wallet_payment_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_wallet_request_owner ON public.merchant_wallet_funding_account_requests FOR SELECT USING (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.user_id = auth.uid()));
CREATE POLICY merchant_wallet_request_owner_insert ON public.merchant_wallet_funding_account_requests FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.user_id = auth.uid()));
CREATE POLICY merchant_wallet_account_owner ON public.merchant_wallet_payment_accounts FOR SELECT USING (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.user_id = auth.uid()));
REVOKE ALL ON TABLE public.merchant_wallet_payment_accounts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.merchant_wallet_payment_accounts FROM anon, authenticated;
GRANT SELECT ON TABLE public.merchant_wallet_payment_accounts TO authenticated;
CREATE OR REPLACE FUNCTION public.persist_merchant_wallet_payment_account(p_request_id uuid, p_merchant_id uuid, p_account_number text, p_account_name text, p_bank_name text, p_currency text, p_provider_account_id text DEFAULT NULL, p_provider_customer_code text DEFAULT NULL)
RETURNS public.merchant_wallet_payment_accounts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ DECLARE v_row public.merchant_wallet_payment_accounts; v_request public.merchant_wallet_funding_account_requests; BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
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
  ON CONFLICT (merchant_id, provider) WHERE status IN ('active','pending') DO UPDATE SET account_number=EXCLUDED.account_number,account_name=EXCLUDED.account_name,bank_name=EXCLUDED.bank_name,status='active',updated_at=now()
  RETURNING * INTO v_row;
  UPDATE public.merchant_wallet_funding_account_requests SET status='fulfilled' WHERE id=p_request_id AND merchant_id=p_merchant_id AND status='pending';
  RETURN v_row;
END; $$;
REVOKE ALL ON FUNCTION public.persist_merchant_wallet_payment_account(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_merchant_wallet_payment_account(uuid,uuid,text,text,text,text,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.fail_merchant_wallet_funding_request(p_request_id uuid,p_merchant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT EXISTS (SELECT 1 FROM public.merchants WHERE id=p_merchant_id AND user_id=(SELECT auth.uid())) THEN RAISE EXCEPTION 'merchant_owner_required' USING ERRCODE='42501'; END IF;
  UPDATE public.merchant_wallet_funding_account_requests SET status='failed' WHERE id=p_request_id AND merchant_id=p_merchant_id AND status='pending';
END; $$;
REVOKE ALL ON FUNCTION public.fail_merchant_wallet_funding_request(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_merchant_wallet_funding_request(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.credit_merchant_wallet_funding(p_merchant_id uuid,p_amount numeric,p_currency text,p_reference text,p_account_number text)
RETURNS TABLE(new_balance numeric, first_credit boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ DECLARE v_balance numeric; v_source_id uuid; v_account_id uuid; BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF p_currency <> 'NGN' OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_funding_amount' USING ERRCODE='22023'; END IF;
  BEGIN
    SELECT id INTO STRICT v_account_id FROM public.merchant_wallet_payment_accounts WHERE merchant_id=p_merchant_id AND account_number=p_account_number AND currency='NGN' AND status='active' FOR UPDATE;
  EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN RAISE EXCEPTION 'merchant_wallet_account_mismatch' USING ERRCODE='P0001';
  END;
  PERFORM pg_advisory_xact_lock(hashtextextended('merchant-wallet-funding:'||p_reference,0));
  v_source_id := (substr(md5(p_merchant_id::text||':'||p_reference),1,8)||'-'||substr(md5(p_merchant_id::text||':'||p_reference),9,4)||'-'||substr(md5(p_merchant_id::text||':'||p_reference),13,4)||'-'||substr(md5(p_merchant_id::text||':'||p_reference),17,4)||'-'||substr(md5(p_merchant_id::text||':'||p_reference),21,12))::uuid;
  IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE source_type='merchant_wallet_topup' AND source_id=v_source_id) THEN
    SELECT available_balance INTO v_balance FROM public.merchant_wallets WHERE merchant_id=p_merchant_id; RETURN QUERY SELECT v_balance,false; RETURN;
  END IF;
  INSERT INTO public.merchant_wallets(merchant_id,available_balance,pending_balance,total_earned) VALUES(p_merchant_id,p_amount,0,0)
    ON CONFLICT (merchant_id) DO UPDATE SET available_balance=public.merchant_wallets.available_balance+EXCLUDED.available_balance,total_earned = public.merchant_wallets.total_earned,updated_at=now()
    RETURNING available_balance INTO v_balance;
  INSERT INTO public.wallet_transactions(wallet_id,merchant_id,type,amount,balance_after,source_type,source_id,description,status)
    SELECT id,p_merchant_id,'credit',p_amount,v_balance,'merchant_wallet_topup',v_source_id,'Merchant wallet bank transfer','completed' FROM public.merchant_wallets WHERE merchant_id=p_merchant_id;
  RETURN QUERY SELECT v_balance,true;
END; $$;
REVOKE ALL ON FUNCTION public.credit_merchant_wallet_funding(uuid,numeric,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_merchant_wallet_funding(uuid,numeric,text,text,text) TO service_role;
COMMIT;
