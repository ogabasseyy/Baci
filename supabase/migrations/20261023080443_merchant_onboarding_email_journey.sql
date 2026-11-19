-- Future merchant enrollments only. Activation requires a completed provider
-- inventory check; installation alone must never start a competing journey.
BEGIN;
CREATE TABLE public.merchant_onboarding_email_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  provider_inventory_checked_at timestamptz,
  provider_inventory_evidence text,
  support_reply_to text,
  CHECK (NOT enabled OR (provider_inventory_checked_at IS NOT NULL
    AND provider_inventory_evidence IS NOT NULL AND length(trim(provider_inventory_evidence)) > 0
    AND support_reply_to IS NOT NULL
    AND support_reply_to ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
);
INSERT INTO public.merchant_onboarding_email_control(singleton) VALUES(true);
ALTER TABLE public.merchant_onboarding_email_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_onboarding_email_control FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.merchant_onboarding_email_control TO service_role;

CREATE TABLE public.merchant_onboarding_email_preferences (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  opt_out_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()
);
CREATE INDEX merchant_onboarding_preferences_owner_idx ON public.merchant_onboarding_email_preferences(owner_user_id);
ALTER TABLE public.merchant_onboarding_email_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_onboarding_email_preferences FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.merchant_onboarding_email_preferences TO service_role;

CREATE TABLE public.merchant_onboarding_email_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK(stage IN ('welcome','day1','day3','day5','day7')),
  journey_version integer NOT NULL DEFAULT 1 CHECK(journey_version=1),
  due_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','dispatching','accepted','skipped','unknown')),
  claim_token uuid,
  claimed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  provider_message_id text,
  outcome_code text,
  UNIQUE(merchant_id,journey_version,stage)
);
CREATE INDEX merchant_onboarding_jobs_due_idx ON public.merchant_onboarding_email_jobs(due_at) WHERE status='pending';
ALTER TABLE public.merchant_onboarding_email_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_onboarding_email_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.merchant_onboarding_email_jobs TO service_role;

-- Only a merchant insert enrolls the journey. No auth.users/customer/staff trigger.
CREATE FUNCTION public.enroll_merchant_onboarding_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.merchant_onboarding_email_preferences(merchant_id,owner_user_id)
    VALUES(NEW.id,NEW.user_id);
  INSERT INTO public.merchant_onboarding_email_jobs(merchant_id,stage,due_at,expires_at)
    SELECT NEW.id, s.stage, clock_timestamp()+s.delay,
      clock_timestamp()+s.delay+interval '24 hours'
    FROM (VALUES ('welcome',interval '2 minutes'),('day1',interval '1 day'),
      ('day3',interval '3 days'),('day5',interval '5 days'),('day7',interval '7 days')) s(stage,delay);
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.enroll_merchant_onboarding_email() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enroll_merchant_onboarding_email AFTER INSERT ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.enroll_merchant_onboarding_email();

-- Retire the broad, unaudited auth confirmation webhook. The old Edge endpoint
-- must also be deployed as its inert 410 implementation before activation.
DROP TRIGGER IF EXISTS on_email_confirmed ON auth.users;
CREATE OR REPLACE FUNCTION public.trigger_welcome_email() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.trigger_welcome_email() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.claim_merchant_onboarding_email_jobs(p_limit integer DEFAULT 20)
RETURNS SETOF public.merchant_onboarding_email_jobs
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.merchant_onboarding_email_control WHERE enabled) THEN RETURN; END IF;
  -- An interrupted dispatch may have reached the provider: never requeue it.
  UPDATE public.merchant_onboarding_email_jobs SET status='unknown',outcome_code='interrupted_dispatch'
    WHERE status='dispatching' AND claimed_at<now()-interval '15 minutes';
  UPDATE public.merchant_onboarding_email_jobs SET status='pending',claim_token=NULL
    WHERE status='processing' AND claimed_at<now()-interval '15 minutes';
  UPDATE public.merchant_onboarding_email_jobs SET status='skipped',outcome_code='expired'
    WHERE status='pending' AND expires_at<=now();
  RETURN QUERY
  WITH candidates AS (
    SELECT j.id FROM public.merchant_onboarding_email_jobs j
    WHERE j.status='pending' AND j.due_at<=now() AND j.expires_at>now()
      AND NOT EXISTS(SELECT 1 FROM public.merchant_onboarding_email_jobs recent
        WHERE recent.merchant_id=j.merchant_id AND recent.status IN ('dispatching','accepted','unknown')
        AND recent.claimed_at>now()-interval '24 hours')
    ORDER BY j.due_at,j.id FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(p_limit,50))
  )
  UPDATE public.merchant_onboarding_email_jobs j SET status='processing',claim_token=gen_random_uuid(),
    claimed_at=now(),attempt_count=j.attempt_count+1
  FROM candidates c WHERE j.id=c.id RETURNING j.*;
END; $$;
REVOKE ALL ON FUNCTION public.claim_merchant_onboarding_email_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_merchant_onboarding_email_jobs(integer) TO service_role;

-- Worker-only, minimal projection: no raw bank details, keys or identity values.
CREATE FUNCTION public.get_merchant_onboarding_email_context(p_merchant_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'merchant_id',m.id,'business_name',coalesce(m.business_name,'Your business'),
    'email',u.email,'confirmed',u.email_confirmed_at IS NOT NULL,
    'enabled',p.enabled AND c.enabled,'reply_to',c.support_reply_to,
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

-- This is the last durable pre-send check. It serializes all stages for a
-- merchant and rechecks opt-out/control immediately before transport dispatch.
CREATE FUNCTION public.begin_merchant_onboarding_email_dispatch(p_id uuid,p_claim_token uuid,p_expected_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE mid uuid; context jsonb;
BEGIN
  SELECT merchant_id INTO mid FROM public.merchant_onboarding_email_jobs WHERE id=p_id;
  PERFORM 1 FROM public.merchant_onboarding_email_preferences WHERE merchant_id=mid FOR UPDATE;
  context := public.get_merchant_onboarding_email_context(mid);
  UPDATE public.merchant_onboarding_email_jobs j SET status='dispatching',claimed_at=now()
  WHERE j.id=p_id AND j.claim_token=p_claim_token AND j.status='processing' AND j.expires_at>now()
    AND EXISTS(SELECT 1 FROM public.merchant_onboarding_email_control c WHERE c.enabled)
    AND (context->>'enabled')::boolean AND (context->>'confirmed')::boolean
    AND (context->>'provisioned')::boolean AND (context->>'email')=p_expected_email
    AND (j.stage='welcome' OR NOT (context->>'is_published')::boolean)
    AND NOT EXISTS(SELECT 1 FROM public.merchant_onboarding_email_jobs recent WHERE recent.merchant_id=j.merchant_id
      AND recent.id<>j.id AND recent.status IN ('dispatching','accepted','unknown') AND recent.claimed_at>now()-interval '24 hours');
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.begin_merchant_onboarding_email_dispatch(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_merchant_onboarding_email_dispatch(uuid,uuid,text) TO service_role;

-- Public capability API: an unguessable token can ONLY disable reminders.
-- No email/merchant identity or subscription state is returned to the caller.
CREATE FUNCTION public.unsubscribe_merchant_onboarding_emails(p_token uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  UPDATE public.merchant_onboarding_email_preferences SET enabled=false WHERE opt_out_token=p_token;
$$;
REVOKE ALL ON FUNCTION public.unsubscribe_merchant_onboarding_emails(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsubscribe_merchant_onboarding_emails(uuid) TO anon, authenticated;
COMMIT;
