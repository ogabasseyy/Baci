-- A wallet-funded lender attempt is a durable liability boundary, not an
-- expiring checkout token. No automatic release or provider-session reuse.
CREATE SCHEMA credit_direct_private;
REVOKE ALL ON SCHEMA credit_direct_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE credit_direct_private.wallet_order_origins(
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE
);
CREATE TABLE credit_direct_private.wallet_attempts(
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),
 merchant_id uuid NOT NULL,customer_id uuid NOT NULL,session_id text NOT NULL UNIQUE,
 gross_amount numeric NOT NULL CHECK(gross_amount>0),wallet_amount numeric NOT NULL CHECK(wallet_amount>0),
 financed_amount numeric NOT NULL CHECK(financed_amount>0),
 provider_reference text,merchant_capture_reference text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(gross_amount=wallet_amount+financed_amount)
);
ALTER TABLE credit_direct_private.wallet_order_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_direct_private.wallet_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON credit_direct_private.wallet_order_origins,credit_direct_private.wallet_attempts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION credit_direct_private.lock_wallet_attempt(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'
 OR NOT pg_try_advisory_xact_lock(hashtextextended('credit_direct_wallet:'||p_order_id::text,0)) THEN
  RAISE EXCEPTION 'credit_direct_wallet_retry_required' USING ERRCODE='40001';
 END IF;
END $$;
CREATE FUNCTION credit_direct_private.track_wallet_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.payment_method='credit_direct' THEN
  INSERT INTO credit_direct_private.wallet_order_origins(order_id) VALUES(NEW.id);
 ELSIF TG_OP='UPDATE' AND NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
  DELETE FROM credit_direct_private.wallet_order_origins WHERE order_id=OLD.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_direct_wallet_origin AFTER INSERT OR UPDATE OF payment_method ON public.orders
 FOR EACH ROW EXECUTE FUNCTION credit_direct_private.track_wallet_origin();

CREATE FUNCTION credit_direct_private.wallet_credit_present(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id AND coalesce(wallet_amount_used,0)<>0)
 OR EXISTS(SELECT 1 FROM public.customer_wallet_transactions WHERE source_id=p_order_id AND source_type IN ('order_redemption','order_refund','order_reversal'));
$$;
CREATE FUNCTION credit_direct_private.validate_wallet_admission(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o record; wallet numeric; parsed_notes jsonb;
BEGIN
 IF NOT credit_direct_private.wallet_credit_present(p_order_id) THEN RETURN; END IF;
 PERFORM credit_direct_private.lock_wallet_attempt(p_order_id);
 IF NOT pg_try_advisory_xact_lock(hashtextextended('baci_order_payment:'||p_order_id::text,0))
 OR NOT pg_try_advisory_xact_lock(('x'||substr(md5(p_order_id::text),1,16))::bit(64)::bigint)
 OR NOT pg_try_advisory_xact_lock(hashtextextended('customer_savings_redemption:'||p_order_id::text,0)) THEN
  RAISE EXCEPTION 'credit_direct_wallet_retry_required' USING ERRCODE='40001';
 END IF;
 SELECT id,merchant_id,customer_id,total,currency,wallet_amount_used,amount_paid,payment_method,payment_status,notes,
  shipping_funding_source,shipping_platform_retained_amount INTO o FROM public.orders WHERE id=p_order_id;
 BEGIN parsed_notes:=coalesce(nullif(o.notes,''),'{}')::jsonb;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'credit_direct_wallet_reconciliation_required' USING ERRCODE='23514'; END;
 IF EXISTS(SELECT 1 FROM credit_direct_private.wallet_attempts WHERE order_id=p_order_id)
 OR o.payment_status NOT IN ('unpaid','pending','partially_paid')
 OR parsed_notes ?| ARRAY['creditDirectSessionId','creditDirectTransactionId','credit_directTransactionId','creditDirectSignedAt','creditDirectClientCompletedSessionId','creditDirectSupersededReferences'] THEN
  RAISE EXCEPTION 'credit_direct_wallet_attempt_pending' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM credit_direct_private.wallet_order_origins WHERE order_id=p_order_id)
 OR o.payment_method IS DISTINCT FROM 'credit_direct' THEN
  RAISE EXCEPTION 'credit_direct_wallet_origin_unverified' USING ERRCODE='23514';
 END IF;
 -- The direct-disbursement Credit Direct path does not implement cumulative
 -- checkout-shipping retention across wallet and lender legs. Fail before signing.
 IF coalesce(o.shipping_platform_retained_amount,0)<>0 THEN
  RAISE EXCEPTION 'credit_direct_wallet_shipping_unsupported' USING ERRCODE='23514';
 END IF;
 IF o.currency IS DISTINCT FROM 'NGN' OR o.customer_id IS NULL OR o.total IS NULL OR o.total<=0
 OR o.total::text IN ('NaN','Infinity','-Infinity')
 OR EXISTS(SELECT 1 FROM public.transactions WHERE order_id=p_order_id AND transaction_type='payment')
 OR EXISTS(SELECT 1 FROM public.customer_savings_redemptions WHERE order_id=p_order_id)
 OR EXISTS(SELECT 1 FROM public.customer_wallet_transactions t WHERE t.source_id=p_order_id
  AND t.source_type IN ('order_redemption','order_refund','order_reversal') AND
  (t.source_type<>'order_redemption' OR t.type IS DISTINCT FROM 'redemption' OR t.status IS DISTINCT FROM 'completed'
   OR t.amount IS NULL OR t.amount<=0 OR t.amount::text IN ('NaN','Infinity','-Infinity')
   OR t.customer_id IS DISTINCT FROM o.customer_id OR t.merchant_id IS DISTINCT FROM o.merchant_id)) THEN
  RAISE EXCEPTION 'credit_direct_wallet_reconciliation_required' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(amount),0) INTO wallet FROM public.customer_wallet_transactions
 WHERE source_id=p_order_id AND source_type='order_redemption' AND type='redemption' AND status='completed';
 IF wallet<=0 OR wallet>=o.total OR wallet IS DISTINCT FROM o.wallet_amount_used OR wallet IS DISTINCT FROM o.amount_paid THEN
  RAISE EXCEPTION 'credit_direct_wallet_reconciliation_required' USING ERRCODE='23514';
 END IF;
END $$;
CREATE FUNCTION credit_direct_private.reserve_wallet_attempt(p_order_id uuid,p_session text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM credit_direct_private.validate_wallet_admission(p_order_id);
 IF NOT credit_direct_private.wallet_credit_present(p_order_id) THEN RETURN; END IF;
 INSERT INTO credit_direct_private.wallet_attempts(order_id,merchant_id,customer_id,session_id,gross_amount,wallet_amount,financed_amount)
 SELECT id,merchant_id,customer_id,p_session,total,wallet_amount_used,total-wallet_amount_used FROM public.orders WHERE id=p_order_id;
END $$;

-- Original capability checks run first; both functions already hold the order
-- row. The reservation and token consumption commit together before a signed
-- session is returned. Token expiry/cleanup can never remove the reservation.
DO $$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('public.issue_credit_direct_checkout_token(uuid,text,uuid,text,text)'::regprocedure);
 needle:='  v_amount := pg_catalog.round(';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Credit Direct token issuer'; END IF;
 EXECUTE replace(definition,needle,'  PERFORM credit_direct_private.validate_wallet_admission(p_order_id);'||chr(10)||needle);
 definition:=pg_get_functiondef('public.set_credit_direct_session(text,uuid,uuid,text,numeric)'::regprocedure);
 needle:='  v_derived := pg_catalog.round(';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected Credit Direct token consumer'; END IF;
 EXECUTE replace(definition,needle,'  PERFORM credit_direct_private.reserve_wallet_attempt(p_order_id,p_session_id);'||chr(10)||needle);
END $$;

CREATE FUNCTION credit_direct_private.guard_wallet_attempt_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a credit_direct_private.wallet_attempts%ROWTYPE; notes jsonb;
BEGIN
 PERFORM credit_direct_private.lock_wallet_attempt(OLD.id);
 SELECT * INTO a FROM credit_direct_private.wallet_attempts WHERE order_id=OLD.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 BEGIN notes:=coalesce(nullif(NEW.notes,''),'{}')::jsonb;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'credit_direct_wallet_attempt_pending' USING ERRCODE='23514'; END;
 IF ROW(NEW.merchant_id,NEW.customer_id,NEW.total,NEW.currency,NEW.wallet_amount_used,NEW.payment_method)
 IS DISTINCT FROM ROW(a.merchant_id,a.customer_id,a.gross_amount,'NGN'::text,a.wallet_amount,'credit_direct'::text)
 OR coalesce(NEW.shipping_platform_retained_amount,0)<>0
 OR notes->>'creditDirectSessionId' IS DISTINCT FROM a.session_id
 OR (CASE WHEN pg_input_is_valid(notes->>'creditDirectSignedAmount','numeric')
  THEN (notes->>'creditDirectSignedAmount')::numeric IS DISTINCT FROM a.financed_amount ELSE true END)
 OR (NEW.amount_paid IS DISTINCT FROM OLD.amount_paid AND NOT
  (auth.role() IS NOT DISTINCT FROM 'service_role' AND a.merchant_capture_reference IS NOT NULL AND NEW.amount_paid>=0 AND NEW.amount_paid<=a.gross_amount)) THEN
  RAISE EXCEPTION 'credit_direct_wallet_attempt_pending' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_direct_wallet_attempt_order BEFORE UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION credit_direct_private.guard_wallet_attempt_order();

CREATE FUNCTION credit_direct_private.guard_wallet_attempt_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_order uuid; new_order uuid; target uuid; a credit_direct_private.wallet_attempts%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='customer_wallet_transactions' THEN
  IF TG_OP<>'INSERT' AND OLD.source_type IN ('order_redemption','order_refund','order_reversal') THEN old_order:=OLD.source_id; END IF;
  IF TG_OP<>'DELETE' AND NEW.source_type IN ('order_redemption','order_refund','order_reversal') THEN new_order:=NEW.source_id; END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN old_order:=OLD.order_id; END IF;
  IF TG_OP<>'DELETE' THEN new_order:=NEW.order_id; END IF;
 END IF;
 FOR target IN SELECT DISTINCT x FROM unnest(ARRAY[old_order,new_order]) t(x) WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM credit_direct_private.lock_wallet_attempt(target);
  SELECT * INTO a FROM credit_direct_private.wallet_attempts WHERE order_id=target;
  IF FOUND THEN
   IF auth.role() IS DISTINCT FROM 'service_role' OR a.merchant_capture_reference IS NULL THEN
    RAISE EXCEPTION 'credit_direct_wallet_attempt_pending' USING ERRCODE='23514';
   END IF;
  ELSIF TG_OP='INSERT' AND (TG_TABLE_NAME='customer_savings_redemptions' OR to_jsonb(NEW)->>'source_type'='order_redemption') AND EXISTS(SELECT 1 FROM public.orders WHERE id=target AND payment_method='credit_direct'
   AND (payment_status IN ('bnpl_pending','bnpl_approved','paid') OR notes LIKE '%creditDirectSessionId%')) THEN
   RAISE EXCEPTION 'credit_direct_wallet_attempt_pending' USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_direct_wallet_attempt_ledger BEFORE INSERT OR UPDATE OR DELETE ON public.customer_wallet_transactions
 FOR EACH ROW EXECUTE FUNCTION credit_direct_private.guard_wallet_attempt_ledger();
CREATE TRIGGER credit_direct_wallet_attempt_savings BEFORE INSERT OR UPDATE OR DELETE ON public.customer_savings_redemptions
 FOR EACH ROW EXECUTE FUNCTION credit_direct_private.guard_wallet_attempt_ledger();

CREATE FUNCTION credit_direct_private.guard_wallet_attempt_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'credit_direct_wallet_attempt_pending' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.order_id,NEW.merchant_id,NEW.customer_id,NEW.session_id,NEW.gross_amount,NEW.wallet_amount,NEW.financed_amount,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.order_id,OLD.merchant_id,OLD.customer_id,OLD.session_id,OLD.gross_amount,OLD.wallet_amount,OLD.financed_amount,OLD.created_at)
 OR (OLD.provider_reference IS NOT NULL AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference)
 OR (OLD.merchant_capture_reference IS NOT NULL AND NEW.merchant_capture_reference IS DISTINCT FROM OLD.merchant_capture_reference) THEN
  RAISE EXCEPTION 'credit_direct_wallet_attempt_pending' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_direct_wallet_snapshot BEFORE UPDATE OR DELETE ON credit_direct_private.wallet_attempts
 FOR EACH ROW EXECUTE FUNCTION credit_direct_private.guard_wallet_attempt_snapshot();

-- Called only by the existing signature-verified provider webhook. Binding a
-- provider reference does not mark the order paid or discharge the reservation.
CREATE FUNCTION public.verify_credit_direct_wallet_event(p_order_id uuid,p_merchant_id uuid,p_reference text,p_merchant_completed boolean,p_provider_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a credit_direct_private.wallet_attempts%ROWTYPE; o record;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 PERFORM credit_direct_private.lock_wallet_attempt(p_order_id);
 SELECT * INTO a FROM credit_direct_private.wallet_attempts WHERE order_id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'credit_direct_wallet_reconciliation_required' USING ERRCODE='23514'; END IF;
 SELECT id,merchant_id,customer_id,total,currency,wallet_amount_used,amount_paid,payment_method,shipping_platform_retained_amount INTO o FROM public.orders WHERE id=p_order_id FOR SHARE;
 IF p_provider_amount IS NULL OR p_provider_amount IS DISTINCT FROM a.financed_amount
 OR coalesce(o.shipping_platform_retained_amount,0)<>0
 OR a.merchant_id IS DISTINCT FROM p_merchant_id OR p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 1 AND 200
 OR ROW(o.merchant_id,o.customer_id,o.total,o.currency,o.wallet_amount_used,o.payment_method)
  IS DISTINCT FROM ROW(a.merchant_id,a.customer_id,a.gross_amount,'NGN'::text,a.wallet_amount,'credit_direct'::text)
 OR (a.provider_reference IS NOT NULL AND a.provider_reference IS DISTINCT FROM p_reference)
 OR (a.merchant_capture_reference IS NULL AND o.amount_paid IS DISTINCT FROM a.wallet_amount) THEN
  RAISE EXCEPTION 'credit_direct_wallet_reconciliation_required' USING ERRCODE='23514';
 END IF;
 UPDATE credit_direct_private.wallet_attempts SET provider_reference=p_reference,
  merchant_capture_reference=CASE WHEN p_merchant_completed THEN p_reference ELSE merchant_capture_reference END WHERE order_id=p_order_id;
 RETURN jsonb_build_object('grossAmount',a.gross_amount,'walletAmount',a.wallet_amount,'financedAmount',a.financed_amount);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA credit_direct_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.verify_credit_direct_wallet_event(uuid,uuid,text,boolean,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_credit_direct_wallet_event(uuid,uuid,text,boolean,numeric) TO service_role;
NOTIFY pgrst,'reload schema';
