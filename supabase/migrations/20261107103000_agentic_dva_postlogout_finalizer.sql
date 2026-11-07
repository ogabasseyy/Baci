-- Dormant post-logout DVA order finalization. The role is intentionally not
-- granted to authenticator: direct SQL contracts may exercise it, but the
-- PostgREST path remains unreachable until its strict hook is live-proven.
DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'agentic_dva_finalizer') THEN
    RAISE EXCEPTION 'agentic DVA finalizer role already exists';
  END IF;
  CREATE ROLE agentic_dva_finalizer
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS;
END;
$roles$;
-- The same CREATEROLE migration principal creates this role above, so it has
-- the ADMIN option needed to reassert the fresh role's non-login state.
ALTER ROLE agentic_dva_finalizer CONNECTION LIMIT -1 PASSWORD NULL;
COMMENT ON ROLE agentic_dva_finalizer IS
  'Dormant signed PostgREST capability for evidence-bound post-logout DVA finalization';
GRANT USAGE ON SCHEMA public TO agentic_dva_finalizer;

-- Add the exact path before the existing GIGL-only early return. No role
-- membership is granted here, so a JWT cannot yet reach this branch.
DO $$
DECLARE
  v_signature constant text := 'public.enforce_gigl_tracking_worker_request_scope()';
  v_definition text := pg_get_functiondef(v_signature::regprocedure);
  v_anchor text := E'  IF auth.role() IS DISTINCT FROM ''gigl_tracking_worker'' THEN\n    RETURN;\n  END IF;';
  v_replacement text := E'  IF auth.role() = ''agentic_dva_finalizer'' THEN\n'
    || E'    IF request_method IS DISTINCT FROM ''POST''\n'
    || E'      OR request_path IS DISTINCT FROM ''/rpc/create_storefront_order_with_cart_binding'' THEN\n'
    || E'      RAISE EXCEPTION ''agentic DVA finalizer request is outside its capability scope'' USING ERRCODE = ''42501'';\n'
    || E'    END IF;\n'
    || E'    RETURN;\n'
    || E'  END IF;\n'
    || E'  IF auth.role() IS DISTINCT FROM ''gigl_tracking_worker'' THEN\n    RETURN;\n  END IF;';
BEGIN
  IF (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'GIGL hook finalizer anchor changed';
  END IF;
  EXECUTE replace(v_definition, v_anchor, v_replacement);
END $$;

-- Boolean-only preflight. It is callable by the existing server-minted
-- authenticated checkout context and does not grant order authority. The
-- binder repeats these checks under its own transaction locks.
CREATE OR REPLACE FUNCTION public.commerce_cart_agentic_dva_recovery_available(
  p_merchant_id uuid,
  p_session_id uuid,
  p_cart_id uuid,
  p_cart_version integer,
  p_generation integer,
  p_account_number text,
  p_finalization_claim text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb := auth.jwt();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_claims ->> 'agentic_context' IS DISTINCT FROM 'checkout'
     OR v_claims ->> 'agentic_merchant_id' IS DISTINCT FROM p_merchant_id::text
     OR v_claims ->> 'agentic_session_id' IS DISTINCT FROM p_session_id::text
     OR p_account_number !~ '^[0-9]{10}$'
     OR p_finalization_claim IS NULL
     OR length(p_finalization_claim) NOT BETWEEN 1 AND 256 THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.commerce_cart_checkout_sessions s
    JOIN public.commerce_cart_grants g
      ON g.id = s.preparing_grant_id
     AND g.merchant_id = s.merchant_id
     AND g.cart_id = s.cart_id
     AND g.principal_id = s.principal_id
    JOIN private.agentic_cart_dispatch_holds h
      ON h.checkout_session_id = s.id
     AND h.merchant_id = s.merchant_id
     AND h.cart_id = s.cart_id
     AND h.checkout_generation = s.checkout_generation
     AND h.cart_version = s.cart_version_reviewed
     AND h.principal_id = s.principal_id
     AND h.state IN ('account_ready', 'order_completed')
    JOIN private.agentic_cart_dispatch_provider_evidence e
      ON e.hold_id = h.id
     AND e.merchant_id = h.merchant_id
     AND e.cart_id = h.cart_id
     AND e.checkout_session_id = h.checkout_session_id
     AND e.checkout_generation = h.checkout_generation
     AND e.cart_version = h.cart_version
     AND e.principal_id = h.principal_id
     AND e.claim_reference = h.claim_reference
     AND h.evidence_reference = e.attestation_jti::text
    JOIN public.checkout_sessions cs
      ON cs.session_id = p_session_id::text
     AND cs.merchant_id = p_merchant_id
     AND cs.payment_reference = p_account_number
     AND cs.order_id IS NULL
     AND cs.status IN ('pending', 'processing')
     AND cs.metadata @> jsonb_build_object('agentic', jsonb_build_object(
       'payment_state', 'order_finalizing',
       'finalization_claim', p_finalization_claim
     ))
    WHERE s.id = p_session_id
      AND s.merchant_id = p_merchant_id
      AND s.cart_id = p_cart_id
      AND s.cart_version_reviewed = p_cart_version
      AND s.checkout_generation = p_generation
      AND ((s.status = 'active' AND s.expires_at > clock_timestamp()) OR s.status = 'submitted')
      AND h.claim_reference = e.claim_reference
      AND e.account_number = p_account_number
      AND (
        g.expires_at <= clock_timestamp()
        OR g.created_at + interval '7 days' <= clock_timestamp()
        OR g.revoked_at IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM public.commerce_cart_device_retirements retired
          WHERE retired.merchant_id = g.merchant_id
            AND retired.device_principal_id = coalesce(g.device_principal_id, g.principal_id)
        )
      )
  );
END;
$$;
ALTER FUNCTION public.commerce_cart_agentic_dva_recovery_available(uuid,uuid,uuid,integer,integer,text,text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_agentic_dva_recovery_available(uuid,uuid,uuid,integer,integer,text,text)
  FROM PUBLIC, anon, service_role, agentic_dva_finalizer;
GRANT EXECUTE ON FUNCTION public.commerce_cart_agentic_dva_recovery_available(uuid,uuid,uuid,integer,integer,text,text)
  TO authenticated;

-- Patch the canonical binder instead of duplicating its order engine. The
-- finalizer still takes the same session/cart/grant locks, validates the live
-- reviewed snapshot, and commits order + cart completion in one transaction.
DO $$
DECLARE
  v_signature constant text := 'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)';
  v_definition text := pg_get_functiondef(v_signature::regprocedure);
  v_claims_anchor text := E'  v_claims jsonb := auth.jwt();\n';
  v_claims_replacement text := E'  v_claims jsonb := auth.jwt();\n  v_dva_recovery jsonb := auth.jwt() -> ''agentic_dva_post_logout'';\n  v_dva_merchant uuid;\n';
  v_merchant_parse_anchor text := E'  -- Guest checkouts ride the same scoped token with `sub` omitted, so the\n';
  v_merchant_parse text := E'  IF nullif(v_dva_recovery ->> ''merchant_id'', '''') IS NOT NULL\n'
    || E'     AND (v_dva_recovery ->> ''merchant_id'') ~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'' THEN\n'
    || E'    v_dva_merchant := (v_dva_recovery ->> ''merchant_id'')::uuid;\n'
    || E'  END IF;\n';
  v_role_anchor text := E'    OR (v_role = ''authenticated'' AND v_agentic_context = ''checkout'' AND v_agentic_merchant IS NOT NULL),';
  v_role_replacement text := E'    OR (v_role = ''authenticated'' AND v_agentic_context = ''checkout'' AND v_agentic_merchant IS NOT NULL)\n'
    || E'    OR (v_role = ''agentic_dva_finalizer'' AND jsonb_typeof(v_dva_recovery) = ''object''),';
  v_merchant_anchor text := E'    OR (v_agentic_context = ''checkout''\n      AND v_agentic_merchant IS DISTINCT FROM v_session.merchant_id) THEN';
  v_merchant_replacement text := E'    OR (v_role = ''authenticated'' AND v_agentic_context = ''checkout''\n      AND v_agentic_merchant IS DISTINCT FROM v_session.merchant_id)\n'
    || E'      OR (v_role = ''agentic_dva_finalizer'' AND v_dva_merchant IS DISTINCT FROM v_session.merchant_id) THEN';
  v_principal_anchor text := E'  IF (p_args ->> ''p_cart_principal_id'') IS DISTINCT FROM v_session.principal_id THEN\n    RAISE EXCEPTION ''cart_order_unauthorized'' USING ERRCODE = ''P0001'';\n  END IF;';
  v_principal_replacement text := E'  IF v_role = ''agentic_dva_finalizer'' THEN\n'
    || E'    IF v_claims ->> ''aud'' IS DISTINCT FROM ''authenticated''\n'
    || E'       OR coalesce(v_claims ->> ''exp'', '''') !~ ''^[0-9]{1,12}$''\n'
    || E'       OR coalesce(v_claims ->> ''iat'', '''') !~ ''^[0-9]{1,12}$''\n'
    || E'       OR (v_claims ->> ''exp'')::numeric <= extract(epoch FROM clock_timestamp())\n'
    || E'       OR (v_claims ->> ''exp'')::numeric > extract(epoch FROM clock_timestamp()) + 60\n'
    || E'       OR (v_claims ->> ''iat'')::numeric > extract(epoch FROM clock_timestamp()) + 5\n'
    || E'       OR (v_claims ->> ''iat'')::numeric < extract(epoch FROM clock_timestamp()) - 60 THEN\n'
    || E'      RAISE EXCEPTION ''cart_order_unauthorized'' USING ERRCODE = ''P0001'';\n'
    || E'    END IF;\n'
    || E'    IF v_dva_recovery ->> ''version'' IS DISTINCT FROM ''1''\n'
    || E'       OR v_dva_recovery ->> ''merchant_id'' IS DISTINCT FROM v_session.merchant_id::text\n'
    || E'       OR v_dva_recovery ->> ''checkout_session_id'' IS DISTINCT FROM v_session.id::text\n'
    || E'       OR v_dva_recovery ->> ''cart_id'' IS DISTINCT FROM v_session.cart_id::text\n'
    || E'       OR v_dva_recovery ->> ''cart_version'' IS DISTINCT FROM v_session.cart_version_reviewed::text\n'
    || E'       OR v_dva_recovery ->> ''checkout_generation'' IS DISTINCT FROM v_session.checkout_generation::text\n'
    || E'       OR coalesce(v_dva_recovery ->> ''account_number'', '''') !~ ''^[0-9]{10}$''\n'
    || E'       OR nullif(v_dva_recovery ->> ''finalization_claim'', '''') IS NULL\n'
    || E'       OR NOT EXISTS (\n'
    || E'         SELECT 1 FROM private.agentic_cart_dispatch_holds h\n'
    || E'         JOIN private.agentic_cart_dispatch_provider_evidence e ON e.hold_id = h.id\n'
    || E'         WHERE h.checkout_session_id = v_session.id\n'
    || E'           AND h.merchant_id = v_session.merchant_id AND h.cart_id = v_session.cart_id\n'
    || E'           AND h.checkout_generation = v_session.checkout_generation\n'
    || E'           AND h.cart_version = v_session.cart_version_reviewed\n'
    || E'           AND h.principal_id = v_session.principal_id AND h.state IN (''account_ready'', ''order_completed'')\n'
    || E'           AND h.evidence_reference = e.attestation_jti::text\n'
    || E'           AND e.merchant_id = h.merchant_id AND e.cart_id = h.cart_id\n'
    || E'           AND e.checkout_session_id = h.checkout_session_id\n'
    || E'           AND e.checkout_generation = h.checkout_generation\n'
    || E'           AND e.cart_version = h.cart_version AND e.principal_id = h.principal_id\n'
    || E'           AND e.claim_reference = h.claim_reference\n'
    || E'           AND e.account_number = (v_dva_recovery ->> ''account_number'')\n'
    || E'       )\n'
    || E'    THEN\n'
    || E'      RAISE EXCEPTION ''cart_order_unauthorized'' USING ERRCODE = ''P0001'';\n'
    || E'    END IF;\n'
    || E'    PERFORM 1 FROM public.checkout_sessions cs\n'
    || E'      WHERE cs.session_id = (v_dva_recovery ->> ''checkout_session_id'')\n'
    || E'        AND cs.merchant_id = v_session.merchant_id\n'
    || E'        AND cs.payment_reference = (v_dva_recovery ->> ''account_number'')\n'
    || E'        AND cs.order_id IS NULL\n'
    || E'        AND cs.status IN (''pending'', ''processing'')\n'
    || E'        AND cs.metadata @> jsonb_build_object(''agentic'', jsonb_build_object(\n'
    || E'          ''payment_state'', ''order_finalizing'',\n'
    || E'          ''finalization_claim'', (v_dva_recovery ->> ''finalization_claim'')\n'
    || E'        )) FOR UPDATE;\n'
    || E'    IF NOT FOUND THEN\n'
    || E'      RAISE EXCEPTION ''cart_order_unauthorized'' USING ERRCODE = ''P0001'';\n'
    || E'    END IF;\n'
    || E'    p_args := jsonb_set(p_args, ''{p_cart_principal_id}'', to_jsonb(v_session.principal_id), true);\n'
    || E'  ELSIF (p_args ->> ''p_cart_principal_id'') IS DISTINCT FROM v_session.principal_id THEN\n'
    || E'    RAISE EXCEPTION ''cart_order_unauthorized'' USING ERRCODE = ''P0001'';\n  END IF;';
  v_admission_anchor text := E'  PERFORM 1 FROM public.commerce_cart_grants g WHERE g.id=v_session.preparing_grant_id AND g.cart_id=v_session.cart_id AND g.merchant_id=v_session.merchant_id AND g.principal_id=v_session.principal_id AND g.expires_at>now() AND g.created_at+interval ''7 days''>now() AND g.revoked_at IS NULL\n    AND NOT EXISTS(SELECT 1 FROM public.commerce_cart_device_retirements retired WHERE retired.merchant_id=g.merchant_id AND retired.device_principal_id=coalesce(g.device_principal_id,g.principal_id)) FOR UPDATE;\n  IF NOT FOUND THEN RAISE EXCEPTION ''cart_order_unauthorized'' USING ERRCODE=''P0001''; END IF;';
  v_admission_replacement text := E'  IF v_role = ''agentic_dva_finalizer'' THEN\n'
    || E'    PERFORM 1 FROM public.commerce_cart_grants g WHERE g.id=v_session.preparing_grant_id\n'
    || E'      AND (g.expires_at>now() AND g.created_at+interval ''7 days''>now() AND g.revoked_at IS NULL)\n'
    || E'      AND NOT EXISTS(SELECT 1 FROM public.commerce_cart_device_retirements retired\n'
    || E'        WHERE retired.merchant_id=g.merchant_id AND retired.device_principal_id=coalesce(g.device_principal_id,g.principal_id));\n'
    || E'    IF FOUND THEN RAISE EXCEPTION ''cart_order_unauthorized'' USING ERRCODE=''P0001''; END IF;\n'
    || E'  ELSE\n'
    || E'    PERFORM 1 FROM public.commerce_cart_grants g WHERE g.id=v_session.preparing_grant_id AND g.cart_id=v_session.cart_id AND g.merchant_id=v_session.merchant_id AND g.principal_id=v_session.principal_id AND g.expires_at>now() AND g.created_at+interval ''7 days''>now() AND g.revoked_at IS NULL\n'
    || E'      AND NOT EXISTS(SELECT 1 FROM public.commerce_cart_device_retirements retired WHERE retired.merchant_id=g.merchant_id AND retired.device_principal_id=coalesce(g.device_principal_id,g.principal_id)) FOR UPDATE;\n'
    || E'    IF NOT FOUND THEN RAISE EXCEPTION ''cart_order_unauthorized'' USING ERRCODE=''P0001''; END IF;\n'
    || E'  END IF;';
  v_payment_anchor text := E'  v_pay_method := coalesce(p_args ->> ''p_payment_method'', ''card'');\n  v_pay_status := coalesce(p_args ->> ''p_payment_status'', ''unpaid'');';
  v_payment_replacement text := E'  IF v_role = ''agentic_dva_finalizer'' AND (p_args ->> ''p_payment_method'' IS DISTINCT FROM ''bank_transfer'' OR p_args ->> ''p_payment_status'' IS DISTINCT FROM ''pending'') THEN\n'
    || E'    RAISE EXCEPTION ''cart_order_unauthorized'' USING ERRCODE = ''P0001'';\n'
    || E'  END IF;\n'
    || E'  v_pay_method := coalesce(p_args ->> ''p_payment_method'', ''card'');\n  v_pay_status := coalesce(p_args ->> ''p_payment_status'', ''unpaid'');';
  v_count integer;
BEGIN
  v_count := (length(v_definition) - length(replace(v_definition, v_claims_anchor, ''))) / length(v_claims_anchor);
  IF v_count <> 1 THEN RAISE EXCEPTION 'cart binder claims anchor changed'; END IF;
  v_definition := replace(v_definition, v_claims_anchor, v_claims_replacement);
  v_count := (length(v_definition) - length(replace(v_definition, v_merchant_parse_anchor, ''))) / length(v_merchant_parse_anchor);
  IF v_count <> 1 THEN RAISE EXCEPTION 'cart binder merchant parser anchor changed'; END IF;
  v_definition := replace(v_definition, v_merchant_parse_anchor, v_merchant_parse || v_merchant_parse_anchor);
  v_count := (length(v_definition) - length(replace(v_definition, v_role_anchor, ''))) / length(v_role_anchor);
  IF v_count <> 1 THEN RAISE EXCEPTION 'cart binder role anchor changed'; END IF;
  v_definition := replace(v_definition, v_role_anchor, v_role_replacement);
  v_count := (length(v_definition) - length(replace(v_definition, v_merchant_anchor, ''))) / length(v_merchant_anchor);
  IF v_count <> 1 THEN RAISE EXCEPTION 'cart binder merchant anchor changed'; END IF;
  v_definition := replace(v_definition, v_merchant_anchor, v_merchant_replacement);
  v_count := (length(v_definition) - length(replace(v_definition, v_principal_anchor, ''))) / length(v_principal_anchor);
  IF v_count <> 1 THEN RAISE EXCEPTION 'cart binder principal anchor changed'; END IF;
  v_definition := replace(v_definition, v_principal_anchor, v_principal_replacement);
  v_count := (length(v_definition) - length(replace(v_definition, v_admission_anchor, ''))) / length(v_admission_anchor);
  IF v_count <> 1 THEN RAISE EXCEPTION 'cart binder admission anchor changed'; END IF;
  v_definition := replace(v_definition, v_admission_anchor, v_admission_replacement);
  v_count := (length(v_definition) - length(replace(v_definition, v_payment_anchor, ''))) / length(v_payment_anchor);
  IF v_count <> 1 THEN RAISE EXCEPTION 'cart binder payment anchor changed'; END IF;
  v_definition := replace(v_definition, v_payment_anchor, v_payment_replacement);
  EXECUTE v_definition;
END $$;

ALTER FUNCTION public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)
  FROM PUBLIC, anon, service_role, agentic_dva_finalizer;
GRANT EXECUTE ON FUNCTION public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)
  TO agentic_dva_finalizer;
