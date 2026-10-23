-- Missing currency is not a supported payment method. Preserve invoker/RLS boundaries.
CREATE OR REPLACE FUNCTION builder_authorization.publication_missing_items(p_merchant uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m record; f record; items jsonb:='[]';active_count int;total_count int;ng boolean;configured boolean;bank boolean;pod boolean;kora boolean;kyc boolean;
BEGIN
 SELECT slug,country,payout_currency,email,phone,support_email,support_phone,bank_code,bank_account_number INTO m FROM public.merchants WHERE id=p_merchant AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT paystack_enabled,korapay_enabled,pay_on_delivery_enabled INTO f FROM public.merchant_feature_settings WHERE merchant_id=p_merchant;
 SELECT count(*) FILTER(WHERE status='active'),count(*) INTO active_count,total_count FROM public.products WHERE merchant_id=p_merchant;
 ng:=nullif(upper(btrim(m.country)),'') IS NULL OR upper(btrim(m.country))='NG';
 configured:=coalesce(public.get_merchant_paystack_subaccount_configured(p_merchant),false);
 bank:=ng AND f.paystack_enabled IS DISTINCT FROM false AND configured AND nullif(btrim(m.bank_account_number),'') IS NOT NULL AND nullif(btrim(m.bank_code),'') IS NOT NULL;
 pod:=coalesce(f.pay_on_delivery_enabled,false);
 kora:=coalesce(f.korapay_enabled,false) AND coalesce(upper(btrim(m.payout_currency)) IN('NGN','KES','GHS','ZAR','XAF','XOF'),false);
 kyc:=NOT ng OR coalesce(public.get_merchant_identity_verified(p_merchant),false);
 IF NOT kyc THEN items:=items||jsonb_build_array('Identity verification (NIN, BVN, or CAC)');END IF;
 IF NOT(bank OR pod OR kora) THEN
  IF ng AND NOT(configured AND nullif(btrim(m.bank_account_number),'') IS NOT NULL AND nullif(btrim(m.bank_code),'') IS NOT NULL AND f.paystack_enabled=false) THEN items:=items||jsonb_build_array('Bank account details');
  ELSE items:=items||jsonb_build_array('Payment method');END IF;
 END IF;
 IF nullif(btrim(m.slug),'') IS NULL THEN items:=items||jsonb_build_array('Store URL');END IF;
 IF active_count=0 THEN items:=items||jsonb_build_array(CASE WHEN total_count>0 THEN 'At least one active product (you have '||total_count||' product(s) but none are active - go to Products and activate them)' ELSE 'At least one active product' END);END IF;
 IF nullif(btrim(m.country),'') IS NULL THEN items:=items||jsonb_build_array('Country/region setting');END IF;
 IF coalesce(nullif(btrim(m.email),''),nullif(btrim(m.phone),''),nullif(btrim(m.support_email),''),nullif(btrim(m.support_phone),'')) IS NULL THEN items:=items||jsonb_build_array('Contact information (email or phone)');END IF;
 RETURN items;
END $$;

-- Only an explicit owner recovery may reset an exhausted cycle. Automatic
-- claim/due functions remain unchanged, including claims from stale work lists.
CREATE FUNCTION public.builder_retry_publication_delivery(p_receipt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r builder_authorization.publication_receipts%ROWTYPE;o builder_authorization.publication_outbox%ROWTYPE;result jsonb;
BEGIN
 SELECT * INTO r FROM builder_authorization.publication_receipts WHERE id=p_receipt AND actor_user_id=auth.uid();
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=r.merchant_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT * INTO o FROM builder_authorization.publication_outbox WHERE receipt_id=r.id FOR UPDATE;
 result:=builder_authorization.publication_result(r.id);
 IF result->>'status'='verifying' AND o.attempts>=20 AND o.completed_at IS NULL AND o.next_attempt_at<=clock_timestamp() AND coalesce(o.lease_expires_at,'-infinity')<=clock_timestamp() THEN
  UPDATE builder_authorization.publication_outbox SET attempts=0 WHERE receipt_id=r.id;
 END IF;
 RETURN public.builder_claim_publication_delivery(r.id);
END $$;
REVOKE ALL ON FUNCTION public.builder_retry_publication_delivery(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.builder_retry_publication_delivery(uuid) TO authenticated;
