-- Shared server cart: handoff grants, preview and redemption.
--
-- Extends the Task 2 commerce_cart_handoffs stub (hash-keyed single-use
-- grants with a one-day post-expiry retention horizon) with origin/
-- destination context plus three RPCs:
--
--   commerce_cart_issue_handoff   convergent grant creation (origin session)
--   commerce_cart_preview_handoff  unauthenticated continuation preview by id
--   commerce_cart_redeem_handoff   single-use connect/merge/keep redemption
--
-- Grant tokens are deterministic HMACs minted server-side (see handoff.ts);
-- the table stores only the hash, so replays converge without any stored
-- secret. Redemption receipts live on the grant row itself
-- (destination_attempt_id + redemption_receipt): the winning attempt
-- replays byte-identically for response-loss recovery, while any other
-- attempt on a consumed grant is rejected. Only successful redemption
-- consumes; validation failures leave the grant pending for retry.

ALTER TABLE public.commerce_cart_handoffs
  ADD COLUMN IF NOT EXISTS origin_principal_id text NULL;
ALTER TABLE public.commerce_cart_handoffs
  ADD COLUMN IF NOT EXISTS operation_id text NULL;
ALTER TABLE public.commerce_cart_handoffs
  ADD COLUMN IF NOT EXISTS destination jsonb NULL;

-- Convergent issue: the same token hash returns the same grant row and
-- never extends expiry or replaces a consumed grant.
CREATE OR REPLACE FUNCTION public.commerce_cart_issue_handoff(
  p_token_hash text, p_handoff_id uuid, p_cart_id uuid,
  p_operation_id text, p_destination jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_merchant uuid;
  v_principal text;
  v_grant uuid;
  v_grant_live boolean;
  v_grant_known boolean;
  v_existing public.commerce_cart_handoffs%ROWTYPE;
  v_op_seen boolean;
  v_id_taken boolean;
  v_cart_found boolean;
BEGIN
  IF nullif(v_claims ->> 'cart_merchant_id', '') IS NULL
    OR (v_claims ->> 'cart_merchant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR nullif(v_claims ->> 'cart_principal_id', '') IS NULL
    OR (v_claims ->> 'cart_scope') <> 'session'
    OR nullif(v_claims ->> 'cart_id', '') IS NULL
    OR (v_claims ->> 'cart_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR (v_claims ->> 'cart_id')::uuid <> p_cart_id
    OR nullif(v_claims ->> 'cart_grant_id', '') IS NULL
    OR (v_claims ->> 'cart_grant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false);
  END IF;
  v_merchant := (v_claims ->> 'cart_merchant_id')::uuid;
  v_principal := v_claims ->> 'cart_principal_id';

  -- Pilot gate (defense in depth with the route-level check): the
  -- shared-cart RPCs refuse merchants without the shared_cart feature,
  -- mirroring the broadcast/account predicates.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_merchant AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'merchant_unavailable', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  v_grant := (v_claims ->> 'cart_grant_id')::uuid;

  IF p_token_hash IS NULL OR length(trim(p_token_hash)) = 0 OR length(p_token_hash) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false);
  END IF;
  IF p_handoff_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false);
  END IF;
  IF p_operation_id IS NULL OR length(trim(p_operation_id)) = 0 OR length(p_operation_id) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false);
  END IF;
  IF jsonb_typeof(p_destination) <> 'object'
    OR NOT ((p_destination ->> 'type') IN ('web', 'native')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cc-handoff|' || p_token_hash, 0)
  );

  SELECT EXISTS (
    SELECT 1 FROM public.commerce_cart_grants g
    WHERE g.id = v_grant AND g.merchant_id = v_merchant AND g.cart_id = p_cart_id
      AND g.principal_id = v_principal AND g.expires_at > now() AND g.revoked_at IS NULL
  ) INTO v_grant_live;
  IF NOT coalesce(v_grant_live, false) THEN
    SELECT EXISTS (SELECT 1 FROM public.commerce_cart_grants g WHERE g.id = v_grant) INTO v_grant_known;
    IF coalesce(v_grant_known, false) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false);
  END IF;

  SELECT * INTO v_existing
  FROM public.commerce_cart_handoffs
  WHERE handoff_hash = p_token_hash AND merchant_id = v_merchant;
  IF FOUND THEN
    IF v_existing.redeemed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed', 'replayed', false);
    END IF;
    IF v_existing.expires_at <= now() THEN
      RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false);
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', true,
      'handoff', jsonb_build_object(
        'id', v_existing.id,
        'expiresAt', to_char(v_existing.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ));
  END IF;

  -- Same operation key, different body: the Task 3 idempotency rule.
  -- Reaching here means (merchant, hash) is new, so any row under this
  -- key carries a different body and must conflict, never mint. The
  -- key lock serializes concurrent issues the way cc-op does for
  -- mutations; it is only ever taken here, after the hash lock, so no
  -- other path can invert the order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cc-handoff-op|' || v_merchant::text || '|' || p_cart_id::text || '|' || v_principal || '|' || p_operation_id, 0)
  );
  SELECT EXISTS (
    SELECT 1 FROM public.commerce_cart_handoffs
    WHERE merchant_id = v_merchant AND source_cart_id = p_cart_id
      AND origin_principal_id = v_principal AND operation_id = p_operation_id
  ) INTO v_op_seen;
  IF coalesce(v_op_seen, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'replayed', false);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.commerce_carts WHERE id = p_cart_id AND merchant_id = v_merchant
  ) INTO v_cart_found;
  IF NOT coalesce(v_cart_found, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false);
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.commerce_cart_handoffs WHERE id = p_handoff_id
  ) INTO v_id_taken;
  IF coalesce(v_id_taken, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false);
  END IF;

  INSERT INTO public.commerce_cart_handoffs
    (id, handoff_hash, merchant_id, source_cart_id, origin_principal_id,
     operation_id, destination, expires_at)
  VALUES (p_handoff_id, p_token_hash, v_merchant, p_cart_id, v_principal,
    p_operation_id, p_destination, now() + interval '5 minutes');

  RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', false,
    'handoff', jsonb_build_object(
      'id', p_handoff_id,
      'expiresAt', to_char((now() + interval '5 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ));
END;
$$;

-- Unauthenticated continuation preview by public handoff id. Never
-- consumes, never reveals the token hash, reports old links honestly.
DROP FUNCTION IF EXISTS public.commerce_cart_preview_handoff(uuid);
CREATE OR REPLACE FUNCTION public.commerce_cart_preview_handoff(
  p_handoff_id uuid, p_token_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row public.commerce_cart_handoffs%ROWTYPE;
  v_merchant_slug text;
  v_snapshot jsonb;
BEGIN
  -- The public handoff id alone never discloses a cart: the caller must
  -- also present the pairing token (by hash) bound to this handoff.
  IF p_handoff_id IS NULL OR nullif(p_token_hash, '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  SELECT * INTO v_row FROM public.commerce_cart_handoffs WHERE id = p_handoff_id;
  IF FOUND AND v_row.handoff_hash <> p_token_hash THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  -- Pilot gate: unenrolled merchants disclose nothing through preview
  -- (same not_found shape as every other preview miss).
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_row.merchant_id AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_row.redeemed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', null, 'status', 'consumed',
      'expiresAt', to_char(v_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  END IF;
  IF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', true, 'code', null, 'status', 'expired',
      'expiresAt', to_char(v_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  END IF;
  SELECT m.slug INTO v_merchant_slug FROM public.merchants m WHERE m.id = v_row.merchant_id;
  SELECT public.commerce_cart_assemble_state(v_row.merchant_id, v_row.source_cart_id) INTO v_snapshot;
  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  -- The preview is unauthenticated: quiz voucher tokens are bearer
  -- credentials and negotiated terms are shopper-private, so neither
  -- leaves with the public handoff id.
  v_snapshot := v_snapshot || jsonb_build_object('lines', COALESCE((
    SELECT jsonb_agg(
      line - 'voucherToken' - 'voucherAwardId'
        - 'negotiatedUnitPriceMinor' - 'negotiationStatus'
      ORDER BY ord
    )
    FROM jsonb_array_elements(COALESCE(v_snapshot -> 'lines', '[]'::jsonb)) WITH ORDINALITY AS t(line, ord)
  ), '[]'::jsonb));
  RETURN jsonb_build_object('ok', true, 'code', null, 'status', 'pending',
    'merchant', jsonb_build_object('id', v_row.merchant_id, 'slug', v_merchant_slug),
    'snapshot', v_snapshot,
    'expiresAt', to_char(v_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;

-- Single-use redemption. Only a successful redemption consumes the
-- grant; every validation failure leaves it pending so the same
-- attempt can retry with corrected versions or resolutions. The
-- winning attempt's receipt replays byte-identically (even after the
-- five-minute grant expiry) while any other attempt is rejected, so
-- response-loss recovery needs the attempt proof — mere knowledge of
-- the consumed URL is insufficient.
CREATE OR REPLACE FUNCTION public.commerce_cart_redeem_handoff(
  p_token_hash text, p_handoff_id uuid, p_attempt_id text, p_choice text,
  p_caller text, p_dest_cart_id uuid,
  p_expected_incoming_version integer, p_expected_dest_version integer,
  p_lines jsonb, p_resolutions jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_merchant uuid;
  v_principal text;
  v_scope text;
  v_claim_cart uuid;
  v_claim_grant uuid;
  v_row public.commerce_cart_handoffs%ROWTYPE;
  v_receipt jsonb;
  v_incoming public.commerce_carts%ROWTYPE;
  v_dest public.commerce_carts%ROWTYPE;
  v_dest_grant uuid;
  v_dest_revoked timestamptz;
  v_grant_live boolean;
  v_grant_known boolean;
  v_state jsonb;
  v_line jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_condition text;
  v_options jsonb;
  v_quantity integer;
  v_voucher_token text;
  v_voucher_award text;
  v_negotiated integer;
  v_neg_status text;
  v_expected_qty integer;
  v_dest_line public.commerce_cart_lines%ROWTYPE;
  v_incoming_line public.commerce_cart_lines%ROWTYPE;
  v_dest_found boolean;
  v_incoming_found boolean;
  v_keep text;
  v_resolution jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_staged jsonb := '[]'::jsonb;
  v_line_count integer;
  v_first uuid;
  v_second uuid;
  v_swap public.commerce_carts%ROWTYPE;
  v_assurance boolean;
  v_assurance_rate numeric;
BEGIN
  IF nullif(v_claims ->> 'cart_merchant_id', '') IS NULL
    OR (v_claims ->> 'cart_merchant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR nullif(v_claims ->> 'cart_principal_id', '') IS NULL
    OR NOT ((v_claims ->> 'cart_scope') IN ('session', 'bootstrap')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  v_merchant := (v_claims ->> 'cart_merchant_id')::uuid;
  v_principal := v_claims ->> 'cart_principal_id';
  v_scope := v_claims ->> 'cart_scope';
  IF v_scope = 'session' THEN
    IF nullif(v_claims ->> 'cart_id', '') IS NULL
      OR (v_claims ->> 'cart_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR nullif(v_claims ->> 'cart_grant_id', '') IS NULL
      OR (v_claims ->> 'cart_grant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    v_claim_cart := (v_claims ->> 'cart_id')::uuid;
    v_claim_grant := (v_claims ->> 'cart_grant_id')::uuid;
    IF p_dest_cart_id IS NULL OR p_dest_cart_id <> v_claim_cart THEN
      RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
  ELSE
    IF p_dest_cart_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
  END IF;

  IF p_token_hash IS NULL OR length(trim(p_token_hash)) = 0 OR length(p_token_hash) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF p_handoff_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF p_attempt_id IS NULL OR length(trim(p_attempt_id)) = 0 OR length(p_attempt_id) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF NOT (p_choice IN ('connect', 'merge', 'keep_existing')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF NOT (p_caller IN ('web', 'native')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF p_choice = 'merge' AND (p_dest_cart_id IS NULL OR jsonb_typeof(p_lines) <> 'array') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF p_resolutions IS NOT NULL AND jsonb_typeof(p_resolutions) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cc-handoff|' || p_token_hash, 0)
  );

  SELECT * INTO v_row FROM public.commerce_cart_handoffs WHERE handoff_hash = p_token_hash;
  IF NOT FOUND OR v_row.merchant_id <> v_merchant THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF v_row.id <> p_handoff_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF (v_row.destination ->> 'type') IS DISTINCT FROM p_caller THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  IF v_row.redeemed_at IS NOT NULL THEN
    IF v_row.destination_attempt_id IS DISTINCT FROM p_attempt_id OR v_row.redemption_receipt IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    v_receipt := v_row.redemption_receipt;
    -- Replay is bound to the principal that redeemed: another caller
    -- holding the attempt id must not receive its cart state or grant.
    IF (v_receipt ->> 'principalId') IS DISTINCT FROM v_principal
      OR (v_receipt ->> 'merchantId') IS DISTINCT FROM v_merchant::text THEN
      RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    IF (v_receipt ->> 'destGrantId') IS NULL
      OR (v_receipt ->> 'destCartId') IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.commerce_cart_grants g
        WHERE g.id = (v_receipt ->> 'destGrantId')::uuid
          AND g.merchant_id = v_merchant
          AND g.cart_id = (v_receipt ->> 'destCartId')::uuid
          AND g.principal_id = v_principal
          AND g.expires_at > now() AND g.revoked_at IS NULL
      ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', true,
      'state', v_receipt -> 'state', 'grantId', v_receipt ->> 'destGrantId',
      'choice', v_receipt ->> 'choice',
      'currentVersion', (v_receipt -> 'state' ->> 'version')::integer);
  END IF;
  IF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  IF v_scope = 'session' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.commerce_cart_grants g
      WHERE g.id = v_claim_grant AND g.merchant_id = v_merchant AND g.cart_id = v_claim_cart
        AND g.principal_id = v_principal AND g.expires_at > now() AND g.revoked_at IS NULL
    ) INTO v_grant_live;
    IF NOT coalesce(v_grant_live, false) THEN
      SELECT EXISTS (SELECT 1 FROM public.commerce_cart_grants g WHERE g.id = v_claim_grant) INTO v_grant_known;
      IF coalesce(v_grant_known, false) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    v_dest_grant := v_claim_grant;
  END IF;

  -- Lock carts in id order (merge touches both) so concurrent merges
  -- cannot deadlock; connect/keep lock the incoming cart only.
  IF p_choice = 'merge' THEN
    IF v_row.source_cart_id < p_dest_cart_id THEN
      v_first := v_row.source_cart_id; v_second := p_dest_cart_id;
    ELSE
      v_first := p_dest_cart_id; v_second := v_row.source_cart_id;
    END IF;
    SELECT * INTO v_incoming FROM public.commerce_carts
    WHERE id = v_first AND merchant_id = v_merchant FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    SELECT * INTO v_dest FROM public.commerce_carts
    WHERE id = v_second AND merchant_id = v_merchant FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    IF v_incoming.id <> v_row.source_cart_id THEN
      v_swap := v_incoming;
      v_incoming := v_dest;
      v_dest := v_swap;
    END IF;
  ELSE
    SELECT * INTO v_incoming FROM public.commerce_carts
    WHERE id = v_row.source_cart_id AND merchant_id = v_merchant FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    IF p_dest_cart_id IS NOT NULL THEN
      SELECT * INTO v_dest FROM public.commerce_carts
      WHERE id = p_dest_cart_id AND merchant_id = v_merchant;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
      END IF;
    END IF;
  END IF;

  -- Pilot gate (defense in depth with the route-level check), checked
  -- only after the caller is bound to this merchant's carts so foreign
  -- attempts keep their unauthorized/not_found shape.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_merchant AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'merchant_unavailable', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  IF v_incoming.state <> 'active' THEN
    SELECT public.commerce_cart_assemble_state(v_merchant, v_incoming.id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'code', 'cart_locked', 'replayed', false,
      'state', v_state, 'currentVersion', v_incoming.version);
  END IF;
  -- A retained cart past its lifetime must not be resurrected by a
  -- five-minute handoff: both sides must still be within retention.
  IF v_incoming.expires_at <= now()
    OR (p_choice = 'merge' AND v_dest.expires_at <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false,
      'state', null, 'currentVersion', v_incoming.version);
  END IF;

  IF p_choice = 'connect' THEN
    IF p_expected_incoming_version IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    IF v_incoming.version <> p_expected_incoming_version THEN
      SELECT public.commerce_cart_assemble_state(v_merchant, v_incoming.id) INTO v_state;
      RETURN jsonb_build_object('ok', false, 'code', 'version_conflict', 'replayed', false,
        'state', v_state, 'currentVersion', v_incoming.version,
        'incomingVersion', v_incoming.version, 'destVersion', NULL);
    END IF;
    SELECT g.id, g.revoked_at INTO v_dest_grant, v_dest_revoked FROM public.commerce_cart_grants g
    WHERE g.cart_id = v_incoming.id AND g.principal_id = v_principal;
    IF FOUND AND v_dest_revoked IS NOT NULL THEN
      -- A retired device stays retired: a retained handoff token must
      -- not silently resurrect the grant revocation retired.
      RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    IF FOUND THEN
      UPDATE public.commerce_cart_grants
      SET expires_at = least(now() + interval '7 days', v_incoming.expires_at)
      WHERE id = v_dest_grant;
    ELSE
      v_dest_grant := pg_catalog.gen_random_uuid();
      INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, principal_type, expires_at)
      VALUES (v_dest_grant, v_merchant, v_incoming.id, v_principal, 'guest',
        least(now() + interval '7 days', v_incoming.expires_at));
    END IF;
    SELECT public.commerce_cart_assemble_state(v_merchant, v_incoming.id) INTO v_state;
    v_receipt := jsonb_build_object('choice', 'connect', 'merchantId', v_merchant,
      'principalId', v_principal, 'destCartId', v_incoming.id,
      'destGrantId', v_dest_grant, 'state', v_state);
    UPDATE public.commerce_cart_handoffs
    SET redeemed_at = now(), destination_attempt_id = p_attempt_id, redemption_receipt = v_receipt
    WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', false,
      'state', v_state, 'currentVersion', v_incoming.version,
      'grantId', v_dest_grant, 'choice', 'connect');
  END IF;

  IF p_choice = 'keep_existing' THEN
    IF p_dest_cart_id IS NOT NULL THEN
      SELECT public.commerce_cart_assemble_state(v_merchant, p_dest_cart_id) INTO v_state;
    ELSE
      v_state := NULL;
    END IF;
    v_receipt := jsonb_build_object('choice', 'keep_existing', 'merchantId', v_merchant,
      'principalId', v_principal, 'destCartId', p_dest_cart_id,
      'destGrantId', v_dest_grant, 'state', v_state);
    UPDATE public.commerce_cart_handoffs
    SET redeemed_at = now(), destination_attempt_id = p_attempt_id, redemption_receipt = v_receipt
    WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', false,
      'state', v_state,
      'currentVersion', CASE WHEN v_state IS NULL THEN NULL ELSE (v_state ->> 'version')::integer END,
      'grantId', v_dest_grant, 'choice', 'keep_existing');
  END IF;

  -- Merge: both snapshots and both versions are consumed transactionally.
  -- The caller computes the union via the shared merge rules; the RPC
  -- enforces versions, locks, membership, max quantities, explicit
  -- conflict choices and authoritative re-pricing.
  IF p_expected_incoming_version IS NULL OR p_expected_dest_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF v_dest.state <> 'active' THEN
    SELECT public.commerce_cart_assemble_state(v_merchant, v_dest.id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'code', 'cart_locked', 'replayed', false,
      'state', v_state, 'currentVersion', v_dest.version,
      'incomingVersion', v_incoming.version, 'destVersion', v_dest.version);
  END IF;
  IF v_incoming.version <> p_expected_incoming_version OR v_dest.version <> p_expected_dest_version THEN
    SELECT public.commerce_cart_assemble_state(v_merchant, v_dest.id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'code', 'version_conflict', 'replayed', false,
      'state', v_state, 'currentVersion', v_dest.version,
      'incomingVersion', v_incoming.version, 'destVersion', v_dest.version);
  END IF;

  SELECT count(*) INTO v_line_count FROM jsonb_array_elements(p_lines);
  IF v_line_count > 20 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  v_staged := '[]'::jsonb;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) value LOOP
    v_assurance := false;
    v_assurance_rate := NULL;
    SELECT pi_product, pi_variant, pi_condition, pi_options, pi_quantity,
      pi_voucher_token, pi_voucher_award, pi_negotiated, pi_neg_status
    INTO v_product_id, v_variant_id, v_condition, v_options, v_quantity,
      v_voucher_token, v_voucher_award, v_negotiated, v_neg_status
    FROM public.commerce_cart_parse_input_line(v_line);
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_staged) s
      WHERE (s.value ->> 'product')::uuid = v_product_id
        AND (s.value ->> 'variant') IS NOT DISTINCT FROM v_variant_id::text
        AND (s.value ->> 'condition') IS NOT DISTINCT FROM v_condition
        AND (s.value -> 'options') = v_options
    ) THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_dest_line FROM public.commerce_cart_lines l
    WHERE l.merchant_id = v_merchant AND l.cart_id = v_dest.id
      AND l.product_id = v_product_id
      AND l.variant_id IS NOT DISTINCT FROM v_variant_id
      AND l.condition IS NOT DISTINCT FROM v_condition
      AND coalesce(l.options, '{}'::jsonb) = v_options
    ORDER BY l.created_at LIMIT 1;
    v_dest_found := FOUND;
    SELECT * INTO v_incoming_line FROM public.commerce_cart_lines l
    WHERE l.merchant_id = v_merchant AND l.cart_id = v_incoming.id
      AND l.product_id = v_product_id
      AND l.variant_id IS NOT DISTINCT FROM v_variant_id
      AND l.condition IS NOT DISTINCT FROM v_condition
      AND coalesce(l.options, '{}'::jsonb) = v_options
    ORDER BY l.created_at LIMIT 1;
    v_incoming_found := FOUND;
    IF NOT v_dest_found AND NOT v_incoming_found THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    -- Attachments are preserved from the stored source lines, never
    -- echoed by the client: handoff preview redacts voucher credentials
    -- and negotiated terms, so a redacted client cannot (and need not)
    -- resubmit them. Identity alone selects the line; the server keeps
    -- whichever side's attachments the merge rules choose.
    IF v_dest_found AND v_incoming_found
      AND (v_dest_line.voucher_token IS DISTINCT FROM v_incoming_line.voucher_token
        OR v_dest_line.voucher_award_id::text IS DISTINCT FROM v_incoming_line.voucher_award_id::text
        OR v_dest_line.negotiated_unit_price_minor IS DISTINCT FROM v_incoming_line.negotiated_unit_price_minor
        OR v_dest_line.negotiation_status IS DISTINCT FROM v_incoming_line.negotiation_status) THEN
      v_keep := NULL;
      FOR v_resolution IN SELECT value FROM jsonb_array_elements(coalesce(p_resolutions, '[]'::jsonb)) value LOOP
        IF (v_resolution -> 'item' ->> 'productId') = v_product_id::text
          AND (v_resolution -> 'item' ->> 'variantId') IS NOT DISTINCT FROM v_variant_id::text
          AND (v_resolution -> 'item' ->> 'condition') IS NOT DISTINCT FROM v_condition
          AND coalesce(v_resolution -> 'item' -> 'options', '{}'::jsonb) = v_options
          AND (v_resolution ->> 'keep') IN ('incoming', 'existing') THEN
          v_keep := v_resolution ->> 'keep';
        END IF;
      END LOOP;
      IF v_keep IS NULL THEN
        v_conflicts := v_conflicts || jsonb_build_object(
          'item', jsonb_build_object('productId', v_product_id, 'variantId', v_variant_id,
            'condition', v_condition, 'options', v_options),
          'existing', jsonb_build_object('quantity', v_dest_line.quantity,
            'voucherToken', v_dest_line.voucher_token,
            'voucherAwardId', v_dest_line.voucher_award_id,
            'negotiatedUnitPriceMinor', v_dest_line.negotiated_unit_price_minor,
            'negotiationStatus', v_dest_line.negotiation_status),
          'incoming', jsonb_build_object('quantity', v_incoming_line.quantity,
            'voucherToken', v_incoming_line.voucher_token,
            'voucherAwardId', v_incoming_line.voucher_award_id,
            'negotiatedUnitPriceMinor', v_incoming_line.negotiated_unit_price_minor,
            'negotiationStatus', v_incoming_line.negotiation_status));
        v_voucher_token := v_dest_line.voucher_token;
        v_voucher_award := v_dest_line.voucher_award_id::text;
        v_negotiated := v_dest_line.negotiated_unit_price_minor;
        v_neg_status := v_dest_line.negotiation_status;
        v_assurance := v_dest_line.has_assurance;
        v_assurance_rate := v_dest_line.assurance_rate;
      ELSIF v_keep = 'incoming' THEN
        v_voucher_token := v_incoming_line.voucher_token;
        v_voucher_award := v_incoming_line.voucher_award_id::text;
        v_negotiated := v_incoming_line.negotiated_unit_price_minor;
        v_neg_status := v_incoming_line.negotiation_status;
        v_assurance := v_incoming_line.has_assurance;
        v_assurance_rate := v_incoming_line.assurance_rate;
      ELSE
        v_voucher_token := v_dest_line.voucher_token;
        v_voucher_award := v_dest_line.voucher_award_id::text;
        v_negotiated := v_dest_line.negotiated_unit_price_minor;
        v_neg_status := v_dest_line.negotiation_status;
        v_assurance := v_dest_line.has_assurance;
        v_assurance_rate := v_dest_line.assurance_rate;
      END IF;
    ELSIF v_dest_found THEN
      v_voucher_token := v_dest_line.voucher_token;
      v_voucher_award := v_dest_line.voucher_award_id::text;
      v_negotiated := v_dest_line.negotiated_unit_price_minor;
      v_neg_status := v_dest_line.negotiation_status;
      v_assurance := v_dest_line.has_assurance;
      v_assurance_rate := v_dest_line.assurance_rate;
    ELSE
      v_voucher_token := v_incoming_line.voucher_token;
      v_voucher_award := v_incoming_line.voucher_award_id::text;
      v_negotiated := v_incoming_line.negotiated_unit_price_minor;
      v_neg_status := v_incoming_line.negotiation_status;
      v_assurance := v_incoming_line.has_assurance;
      v_assurance_rate := v_incoming_line.assurance_rate;
    END IF;
    IF v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN
      v_expected_qty := 1;
    ELSE
      v_expected_qty := greatest(coalesce(v_dest_line.quantity, 0), coalesce(v_incoming_line.quantity, 0));
    END IF;
    IF v_quantity <> v_expected_qty THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    v_staged := v_staged || jsonb_build_object(
      'product', v_product_id, 'variant', v_variant_id, 'condition', v_condition,
      'options', v_options, 'quantity', v_quantity, 'voucherToken', v_voucher_token,
      'voucherAward', v_voucher_award, 'negotiated', v_negotiated,
      'negStatus', v_neg_status, 'assurance', v_assurance,
      'assuranceRate', v_assurance_rate);
  END LOOP;

  FOR v_resolution IN SELECT value FROM jsonb_array_elements(coalesce(p_resolutions, '[]'::jsonb)) value LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_staged) s
      WHERE (s.value ->> 'product') = (v_resolution -> 'item' ->> 'productId')
        AND (s.value ->> 'variant') IS NOT DISTINCT FROM (v_resolution -> 'item' ->> 'variantId')
        AND (s.value ->> 'condition') IS NOT DISTINCT FROM (v_resolution -> 'item' ->> 'condition')
        AND (s.value -> 'options') = coalesce(v_resolution -> 'item' -> 'options', '{}'::jsonb)
    ) THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    SELECT public.commerce_cart_assemble_state(v_merchant, v_dest.id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'code', 'merge_conflict', 'replayed', false,
      'state', v_state, 'currentVersion', v_dest.version,
      'incomingVersion', v_incoming.version, 'destVersion', v_dest.version,
      'conflicts', v_conflicts);
  END IF;

  DELETE FROM public.commerce_cart_lines
  WHERE merchant_id = v_merchant AND cart_id = v_dest.id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_staged) value LOOP
    PERFORM public.commerce_cart_require_offer(v_merchant,
      (v_line ->> 'product')::uuid,
      CASE WHEN v_line ->> 'variant' IS NULL THEN NULL ELSE (v_line ->> 'variant')::uuid END);
    INSERT INTO public.commerce_cart_lines (
      merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
      negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
      has_assurance, assurance_rate, last_unit_price_minor
    ) VALUES (
      v_merchant, v_dest.id,
      (v_line ->> 'product')::uuid,
      CASE WHEN v_line ->> 'variant' IS NULL THEN NULL ELSE (v_line ->> 'variant')::uuid END,
      v_line ->> 'condition', v_line -> 'options',
      CASE WHEN (v_line ->> 'voucherToken') IS NOT NULL OR (v_line ->> 'voucherAward') IS NOT NULL
        THEN 1 ELSE (v_line ->> 'quantity')::integer END,
      CASE WHEN v_line ->> 'negotiated' IS NULL THEN NULL ELSE (v_line ->> 'negotiated')::integer END,
      v_line ->> 'negStatus',
      v_line ->> 'voucherToken',
      CASE WHEN v_line ->> 'voucherAward' IS NULL THEN NULL ELSE (v_line ->> 'voucherAward')::uuid END,
      coalesce((v_line ->> 'assurance')::boolean, false),
      CASE WHEN v_line ->> 'assuranceRate' IS NULL THEN NULL ELSE (v_line ->> 'assuranceRate')::numeric END,
      public.commerce_cart_offer_price_minor(v_merchant,
        (v_line ->> 'product')::uuid,
        CASE WHEN v_line ->> 'variant' IS NULL THEN NULL ELSE (v_line ->> 'variant')::uuid END)
    );
  END LOOP;

  UPDATE public.commerce_carts SET version = v_dest.version + 1, updated_at = now()
  WHERE id = v_dest.id;
  -- Notify other devices holding the destination cart, mirroring the
  -- mutation outbox write; without this row a merge stays invisible
  -- until a later poll or focus refresh.
  INSERT INTO public.commerce_cart_events
    (merchant_id, cart_id, version, operation_id, payload, expires_at)
  VALUES (
    v_merchant, v_dest.id, v_dest.version + 1, p_attempt_id,
    jsonb_build_object(
      'cartId', v_dest.id, 'version', v_dest.version + 1, 'operationId', p_attempt_id
    ),
    now() + interval '7 days'
  );
  SELECT public.commerce_cart_assemble_state(v_merchant, v_dest.id) INTO v_state;
  v_receipt := jsonb_build_object('choice', 'merge', 'merchantId', v_merchant,
    'principalId', v_principal, 'destCartId', v_dest.id,
    'destGrantId', v_dest_grant, 'state', v_state);
  UPDATE public.commerce_cart_handoffs
  SET redeemed_at = now(), destination_attempt_id = p_attempt_id, redemption_receipt = v_receipt
  WHERE id = v_row.id;
  RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', false,
    'state', v_state, 'currentVersion', v_dest.version + 1,
    'grantId', v_dest_grant, 'choice', 'merge');
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'invalid_line' OR SQLERRM = 'invalid_offer' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RAISE;
END;
$$;

-- Cheap merchant locator for the unauthenticated preview route: the
-- merchant-scoped preview quota must run before the expensive snapshot
-- assembly in commerce_cart_preview_handoff. Token-gated exactly like
-- the preview itself: knowing a handoff id alone discloses nothing,
-- not even which merchant it belongs to.
DROP FUNCTION IF EXISTS public.commerce_cart_handoff_merchant(uuid);
CREATE OR REPLACE FUNCTION public.commerce_cart_handoff_merchant(
  p_handoff_id uuid, p_token_hash text
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT merchant_id FROM public.commerce_cart_handoffs
  WHERE id = p_handoff_id AND handoff_hash = p_token_hash;
$$;

ALTER FUNCTION public.commerce_cart_issue_handoff(text, uuid, uuid, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.commerce_cart_preview_handoff(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.commerce_cart_handoff_merchant(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.commerce_cart_redeem_handoff(text, uuid, text, text, text, uuid, integer, integer, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_issue_handoff(text, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commerce_cart_preview_handoff(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commerce_cart_redeem_handoff(text, uuid, text, text, text, uuid, integer, integer, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commerce_cart_issue_handoff(text, uuid, uuid, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commerce_cart_redeem_handoff(text, uuid, text, text, text, uuid, integer, integer, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_cart_issue_handoff(text, uuid, uuid, text, jsonb) TO commerce_cart_shopper;
GRANT EXECUTE ON FUNCTION public.commerce_cart_redeem_handoff(text, uuid, text, text, text, uuid, integer, integer, jsonb, jsonb) TO commerce_cart_shopper;
GRANT EXECUTE ON FUNCTION public.commerce_cart_preview_handoff(uuid, text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.commerce_cart_handoff_merchant(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_cart_handoff_merchant(uuid, text) TO anon, authenticated, service_role;
