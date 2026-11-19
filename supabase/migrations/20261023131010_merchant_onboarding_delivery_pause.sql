-- Keep a temporary global pause separate from a merchant opt-out.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_merchant_onboarding_email_context(p_merchant_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'merchant_id',m.id,'business_name',coalesce(m.business_name,'Your business'),
    'email',u.email,'confirmed',u.email_confirmed_at IS NOT NULL,
    'enabled',p.enabled,'delivery_enabled',c.enabled,'reply_to',c.support_reply_to,
    'opt_out_token',p.opt_out_token,'is_published',coalesce(m.is_published,false),
    'provisioned',EXISTS(SELECT 1 FROM public.page_configs pc WHERE pc.merchant_id=m.id AND pc.page_slug='home')
      AND EXISTS(SELECT 1 FROM public.domains d WHERE d.merchant_id=m.id),
    'slug',m.slug,'country',m.country,'payout_currency',m.payout_currency,
    'has_contact',coalesce(length(trim(m.support_email)),0)>0 OR coalesce(length(trim(m.support_phone)),0)>0 OR coalesce(length(trim(m.email)),0)>0 OR coalesce(length(trim(m.phone)),0)>0,
    'bank_configured',coalesce(length(trim(m.bank_code)),0)>0 AND coalesce(length(trim(m.bank_account_number)),0)>0,
    'paystack_configured',coalesce(length(trim(m.paystack_subaccount_code)),0)>0,
    'feature_settings',jsonb_build_object('paystack_enabled',f.paystack_enabled,'korapay_enabled',f.korapay_enabled,'pay_on_delivery_enabled',f.pay_on_delivery_enabled),
    'identity_verified',EXISTS(SELECT 1 FROM public.merchant_verifications v WHERE v.merchant_id=m.id AND (v.nin_verified OR v.bvn_verified OR v.cac_verified)),
    'active_product_count',(SELECT count(*) FROM public.products pr WHERE pr.merchant_id=m.id AND pr.status='active')
  ) FROM public.merchants m
  JOIN public.merchant_onboarding_email_preferences p ON p.merchant_id=m.id AND p.owner_user_id=m.user_id
  JOIN auth.users u ON u.id=m.user_id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
  CROSS JOIN public.merchant_onboarding_email_control c
  LEFT JOIN public.merchant_feature_settings f ON f.merchant_id=m.id
  WHERE m.id=p_merchant_id;
$$;
REVOKE ALL ON FUNCTION public.get_merchant_onboarding_email_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_merchant_onboarding_email_context(uuid) TO service_role;
COMMIT;
