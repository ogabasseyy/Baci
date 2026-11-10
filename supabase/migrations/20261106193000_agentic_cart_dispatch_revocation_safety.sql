-- Every hold FK needs a non-partial index. The live-only index cannot support
-- checks for terminal holds during cart updates/deletes.
-- This migration preserves unresolved holds after logout but does not grant
-- post-revocation order-finalization authority; that requires trusted provider
-- evidence and a separate restricted recovery boundary.
CREATE INDEX IF NOT EXISTS agentic_cart_dispatch_holds_cart_fk_idx
  ON private.agentic_cart_dispatch_holds(merchant_id, cart_id);

CREATE OR REPLACE FUNCTION private.guard_agentic_cart_dispatch_hold()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_new_merchant uuid;
  v_new_cart uuid;
  v_old_merchant uuid;
  v_old_cart uuid;
  v_hold private.agentic_cart_dispatch_holds%ROWTYPE;
  v_session public.commerce_cart_checkout_sessions%ROWTYPE;
BEGIN
  v_new_merchant := (to_jsonb(NEW) ->> 'merchant_id')::uuid;
  v_old_merchant := (to_jsonb(OLD) ->> 'merchant_id')::uuid;
  IF TG_TABLE_NAME = 'commerce_carts' THEN
    v_new_cart := (to_jsonb(NEW) ->> 'id')::uuid;
    v_old_cart := (to_jsonb(OLD) ->> 'id')::uuid;
  ELSIF TG_TABLE_NAME = 'commerce_cart_handoffs' THEN
    v_new_cart := (to_jsonb(NEW) ->> 'source_cart_id')::uuid;
    v_old_cart := (to_jsonb(OLD) ->> 'source_cart_id')::uuid;
  ELSE
    v_new_cart := (to_jsonb(NEW) ->> 'cart_id')::uuid;
    v_old_cart := (to_jsonb(OLD) ->> 'cart_id')::uuid;
  END IF;
  SELECT * INTO v_hold FROM private.agentic_cart_dispatch_holds h
   WHERE ((h.merchant_id = v_new_merchant AND h.cart_id = v_new_cart)
       OR (h.merchant_id = v_old_merchant AND h.cart_id = v_old_cart))
     AND h.state IN ('outcome_unknown', 'account_ready')
   ORDER BY h.created_at LIMIT 1;
  IF NOT FOUND THEN RETURN coalesce(NEW, OLD); END IF;

  IF TG_TABLE_NAME = 'commerce_carts' THEN
    IF TG_OP = 'UPDATE'
       AND current_setting('baci.agentic_dispatch_admission_hold', true) = v_hold.id::text
       AND (to_jsonb(NEW) - 'provider_dispatch_fence') = (to_jsonb(OLD) - 'provider_dispatch_fence')
       AND NEW.provider_dispatch_fence = OLD.provider_dispatch_fence + 1 THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.id = v_hold.cart_id AND NEW.merchant_id = v_hold.merchant_id
       AND NEW.state = 'completed' AND OLD.state IN ('active', 'checkout')
       AND NEW.version IN (OLD.version, OLD.version + 1) THEN
      SELECT * INTO v_session FROM public.commerce_cart_checkout_sessions s
       WHERE s.id = v_hold.checkout_session_id AND s.merchant_id = v_hold.merchant_id
         AND s.cart_id = v_hold.cart_id AND s.checkout_generation = v_hold.checkout_generation
         AND s.cart_version_reviewed = v_hold.cart_version AND s.principal_id = v_hold.principal_id
         AND s.status = 'submitted' AND s.order_id IS NOT NULL;
      IF FOUND THEN
        UPDATE private.agentic_cart_dispatch_holds
           SET state = 'order_completed', reconciled_at = clock_timestamp()
         WHERE id = v_hold.id;
        RETURN NEW;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'commerce_cart_checkout_sessions' THEN
    IF TG_OP = 'UPDATE' AND NEW.id = v_hold.checkout_session_id
       AND NEW.status = 'submitted' AND NEW.order_id IS NOT NULL
       AND NEW.merchant_id = OLD.merchant_id AND NEW.cart_id = OLD.cart_id
       AND NEW.checkout_generation = OLD.checkout_generation
       AND NEW.cart_version_reviewed = OLD.cart_version_reviewed
       AND NEW.principal_id = OLD.principal_id THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'commerce_cart_grants' THEN
    -- The scoped device-revoker writes this tombstone before revoking grants.
    -- Permit only NULL -> revoked_at with all authority-bearing fields fixed;
    -- the tombstone itself prevents future use or dispatch.
    IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
       AND (to_jsonb(NEW) - ARRAY['revoked_at','updated_at'])
           = (to_jsonb(OLD) - ARRAY['revoked_at','updated_at'])
       AND EXISTS (
         SELECT 1 FROM public.commerce_cart_device_retirements r
         WHERE r.merchant_id = NEW.merchant_id
           AND r.device_principal_id = coalesce(NEW.device_principal_id, NEW.principal_id)
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'cart is held for unresolved provider dispatch' USING ERRCODE = '55000';
END $$;

CREATE OR REPLACE FUNCTION public.commerce_cart_admit_agentic_dva_dispatch(
  p_claim_reference text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_binding jsonb;
  v_merchant uuid;
  v_cart uuid;
  v_checkout_session uuid;
  v_generation integer;
  v_cart_version integer;
  v_principal text;
  v_agentic_session text;
  v_grant_device text;
  v_cc_session public.commerce_cart_checkout_sessions%ROWTYPE;
  v_cart_row public.commerce_carts%ROWTYPE;
  v_grant public.commerce_cart_grants%ROWTYPE;
  v_payment record;
  v_hold private.agentic_cart_dispatch_holds%ROWTYPE;
BEGIN
  IF NOT coalesce((SELECT enabled FROM private.agentic_cart_dispatch_rollout WHERE singleton), false)
     OR v_claims ->> 'role' IS DISTINCT FROM 'authenticated'
     OR v_claims ->> 'aud' IS DISTINCT FROM 'authenticated'
     OR v_claims ->> 'agentic_context' IS DISTINCT FROM 'checkout'
     OR nullif(v_claims ->> 'agentic_merchant_id', '') IS NULL
     OR (v_claims ->> 'agentic_merchant_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR coalesce(length(p_claim_reference), 0) NOT BETWEEN 1 AND 256 THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  v_merchant := (v_claims ->> 'agentic_merchant_id')::uuid;
  v_binding := v_claims -> 'agentic_shared_cart_checkout_binding';
  IF jsonb_typeof(v_binding) IS DISTINCT FROM 'object'
     OR v_binding ->> 'version' IS DISTINCT FROM '1'
     OR v_binding ->> 'identity_kind' IS DISTINCT FROM 'idempotent'
     OR v_binding ->> 'checkout_variant' IS DISTINCT FROM 'base'
     OR ((v_binding ->> 'cart_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS NOT TRUE
     OR ((v_binding ->> 'checkout_session_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS NOT TRUE
     OR coalesce(v_binding ->> 'principal_id', '') = ''
     OR coalesce(v_binding ->> 'agentic_session_id', '') = ''
     OR v_binding ->> 'agentic_session_id' IS DISTINCT FROM v_claims ->> 'agentic_session_id'
     OR ((v_binding ->> 'checkout_generation') ~ '^[1-9][0-9]*$') IS NOT TRUE
     OR ((v_binding ->> 'cart_version') ~ '^[1-9][0-9]*$') IS NOT TRUE THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  v_cart := (v_binding ->> 'cart_id')::uuid;
  v_checkout_session := (v_binding ->> 'checkout_session_id')::uuid;
  v_generation := (v_binding ->> 'checkout_generation')::integer;
  v_cart_version := (v_binding ->> 'cart_version')::integer;
  v_principal := v_binding ->> 'principal_id';
  v_agentic_session := v_binding ->> 'agentic_session_id';

  SELECT * INTO v_cc_session FROM public.commerce_cart_checkout_sessions s
   WHERE s.id = v_checkout_session FOR UPDATE;
  IF NOT FOUND OR v_cc_session.merchant_id <> v_merchant OR v_cc_session.cart_id <> v_cart
     OR v_cc_session.checkout_generation <> v_generation
     OR v_cc_session.cart_version_reviewed <> v_cart_version
     OR v_cc_session.principal_id <> v_principal OR v_cc_session.status <> 'active'
     OR v_cc_session.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;

  -- Read the grant's effective device identity before taking the revocation
  -- lock; re-read it FOR UPDATE after the lock to close linked-device races.
  SELECT * INTO v_grant FROM public.commerce_cart_grants g
   WHERE g.id = v_cc_session.preparing_grant_id AND g.merchant_id = v_merchant
     AND g.cart_id = v_cart AND g.principal_id = v_principal;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'blocked'); END IF;
  v_grant_device := coalesce(v_grant.device_principal_id, v_grant.principal_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'cc-device-revoke|' || v_merchant::text || '|' || v_grant_device, 0));
  SELECT * INTO v_cart_row FROM public.commerce_carts c
   WHERE c.id = v_cart AND c.merchant_id = v_merchant FOR UPDATE;
  IF NOT FOUND OR v_cart_row.state <> 'active' OR v_cart_row.expires_at <= clock_timestamp()
     OR v_cart_row.version <> v_cart_version THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  SELECT * INTO v_grant FROM public.commerce_cart_grants g
   WHERE g.id = v_cc_session.preparing_grant_id AND g.merchant_id = v_merchant
     AND g.cart_id = v_cart AND g.principal_id = v_principal
     AND g.expires_at > clock_timestamp() AND g.revoked_at IS NULL
   FOR UPDATE;
  IF NOT FOUND OR coalesce(v_grant.device_principal_id, v_grant.principal_id) IS DISTINCT FROM v_grant_device
     OR EXISTS (
       SELECT 1 FROM public.commerce_cart_device_retirements r
       WHERE r.merchant_id = v_merchant AND r.device_principal_id = v_grant_device
     ) THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;

  SELECT cs.session_id, cs.payment_reference, cs.order_id, cs.virtual_account_number,
         cs.status, cs.metadata, cs.merchant_id
    INTO v_payment FROM public.checkout_sessions cs
   WHERE cs.session_id = v_agentic_session FOR UPDATE;
  IF NOT FOUND OR v_payment.merchant_id <> v_merchant
     OR v_payment.payment_reference IS DISTINCT FROM p_claim_reference
     OR v_payment.order_id IS NOT NULL OR v_payment.virtual_account_number IS NOT NULL
     OR v_payment.status <> 'processing'
     OR v_payment.metadata #>> '{agentic,payment_state}' IS DISTINCT FROM 'claiming_payment' THEN
    RETURN jsonb_build_object('status', 'blocked');
  END IF;
  SELECT * INTO v_hold FROM private.agentic_cart_dispatch_holds h
   WHERE h.checkout_session_id = v_checkout_session OR h.claim_reference = p_claim_reference;
  IF FOUND THEN RETURN jsonb_build_object('status', 'dispatch_unknown'); END IF;
  INSERT INTO private.agentic_cart_dispatch_holds(
    merchant_id, cart_id, checkout_session_id, checkout_generation,
    cart_version, principal_id, claim_reference
  ) VALUES (
    v_merchant, v_cart, v_checkout_session, v_generation,
    v_cart_version, v_principal, p_claim_reference
  ) RETURNING * INTO v_hold;
  PERFORM pg_catalog.set_config('baci.agentic_dispatch_admission_hold', v_hold.id::text, true);
  UPDATE public.commerce_carts SET provider_dispatch_fence = provider_dispatch_fence + 1
   WHERE id = v_cart AND merchant_id = v_merchant;
  RETURN jsonb_build_object('status', 'dispatch_permitted', 'hold_id', v_hold.id);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('status', 'blocked');
END $$;

ALTER FUNCTION public.commerce_cart_admit_agentic_dva_dispatch(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_admit_agentic_dva_dispatch(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_admit_agentic_dva_dispatch(text) TO authenticated;
