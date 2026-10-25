-- Exact product_offers identity for delegated cart lines.
-- Same canonical condition under two merchant spellings must stay two lines.
-- offer_id is nullable and has no foreign key: abandoned carts must not block
-- offer deletion, and a deleted offer must not be nulled before the order
-- agreement check. Writers validate the id; readers snapshot it.
ALTER TABLE public.commerce_cart_lines
  ADD COLUMN IF NOT EXISTS offer_id uuid;

COMMENT ON COLUMN public.commerce_cart_lines.offer_id IS
  'Exact product_offers id. Null is the condition-only lane. Validated at write time; no FK.';

CREATE OR REPLACE FUNCTION public.commerce_cart_parse_offer_id(p_line jsonb)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_text text;
BEGIN
  IF jsonb_typeof(p_line) <> 'object' THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  v_item := p_line -> 'item';
  IF jsonb_typeof(v_item) <> 'object' THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (v_item ? 'offerId') OR jsonb_typeof(v_item -> 'offerId') = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v_item -> 'offerId') <> 'string' THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  v_text := v_item ->> 'offerId';
  IF v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_text::uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_cart_parse_offer_id(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.commerce_cart_require_exact_offer(
  p_merchant_id uuid,
  p_product_id uuid,
  p_condition text,
  p_offer_id uuid
) RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF p_offer_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.product_offers offer
    WHERE offer.id = p_offer_id
      AND offer.merchant_id = p_merchant_id
      AND offer.product_id = p_product_id
      AND offer.status = 'active'
      AND (
        p_condition IS NULL
        OR discovery.canonical_product_condition(offer.condition)
          = discovery.canonical_product_condition(p_condition)
      )
  ) THEN
    RAISE EXCEPTION 'invalid_offer' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_cart_require_exact_offer(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.commerce_cart_offer_price_minor(
  p_merchant_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_condition text,
  p_offer_id uuid
) RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_offer_id IS NOT NULL THEN coalesce(
      (
        SELECT round(offer.price * 100)::bigint
        FROM public.product_offers offer
        WHERE offer.id = p_offer_id
          AND offer.merchant_id = p_merchant_id
          AND offer.product_id = p_product_id
          AND offer.status = 'active'
      ),
      public.commerce_cart_offer_price_minor(
        p_merchant_id, p_product_id, p_variant_id, p_condition
      )
    )
    ELSE public.commerce_cart_offer_price_minor(
      p_merchant_id, p_product_id, p_variant_id, p_condition
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.commerce_cart_offer_price_minor(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION pg_temp.patch_cart_fn(
  signature text,
  old text,
  replacement text,
  expected integer
) RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  definition text;
  found integer;
BEGIN
  definition := pg_catalog.pg_get_functiondef(signature::regprocedure);
  IF old = '' THEN
    RAISE EXCEPTION 'empty cart offer patch for %', signature;
  END IF;
  found := (length(definition) - length(replace(definition, old, ''))) / length(old);
  IF found <> expected THEN
    RAISE EXCEPTION 'cart offer id source mismatch for % expected % found %', signature, expected, found;
  END IF;
  EXECUTE replace(definition, old, replacement);
END;
$fn$;

-- Add: validate, merge, and store the exact offer. Negotiation lanes stay distinct.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
    v_neg_status:=public.commerce_cart_negotiation_status(v_merchant,v_product_id,v_variant_id,v_condition,v_negotiated,v_neg_status);$old$,
  $new$    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
    v_neg_status:=public.commerce_cart_negotiation_status(v_merchant,v_product_id,v_variant_id,v_condition,v_negotiated,v_neg_status);
    PERFORM public.commerce_cart_require_exact_offer(v_merchant, v_product_id, v_condition, public.commerce_cart_parse_offer_id(p_command));$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$      AND voucher_award_id IS NOT DISTINCT FROM v_voucher_award::uuid
      AND negotiated_unit_price_minor IS NOT DISTINCT FROM v_negotiated
      AND negotiation_status IS NOT DISTINCT FROM v_neg_status;$old$,
  $new$      AND voucher_award_id IS NOT DISTINCT FROM v_voucher_award::uuid
      AND negotiated_unit_price_minor IS NOT DISTINCT FROM v_negotiated
      AND negotiation_status IS NOT DISTINCT FROM v_neg_status
      AND offer_id IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(p_command);$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$      INSERT INTO public.commerce_cart_lines (
        merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
        negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
        last_unit_price_minor, has_assurance, assurance_rate
      ) VALUES (
        v_merchant, p_cart_id, v_product_id, v_variant_id, v_condition, v_options,
        CASE WHEN v_voucher_token IS NOT NULL AND v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status),
        v_voucher_token, v_voucher_award::uuid,
        public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id, v_condition), coalesce((p_command->>'hasAssurance')::boolean,false), CASE WHEN coalesce((p_command->>'hasAssurance')::boolean,false) THEN 0.05 ELSE NULL END
      );$old$,
  $new$      INSERT INTO public.commerce_cart_lines (
        merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
        negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
        last_unit_price_minor, has_assurance, assurance_rate, offer_id
      ) VALUES (
        v_merchant, p_cart_id, v_product_id, v_variant_id, v_condition, v_options,
        CASE WHEN v_voucher_token IS NOT NULL AND v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status),
        v_voucher_token, v_voucher_award::uuid,
        public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id, v_condition, public.commerce_cart_parse_offer_id(p_command)), coalesce((p_command->>'hasAssurance')::boolean,false), CASE WHEN coalesce((p_command->>'hasAssurance')::boolean,false) THEN 0.05 ELSE NULL END,
        public.commerce_cart_parse_offer_id(p_command)
      );$new$,
  1
);

-- Replace carries the same offer identity as add.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
      v_neg_status := public.commerce_cart_negotiation_status(v_merchant,v_product_id,v_variant_id,v_condition,v_negotiated,v_neg_status);$old$,
  $new$PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
      v_neg_status := public.commerce_cart_negotiation_status(v_merchant,v_product_id,v_variant_id,v_condition,v_negotiated,v_neg_status);
      PERFORM public.commerce_cart_require_exact_offer(v_merchant, v_product_id, v_condition, public.commerce_cart_parse_offer_id(v_entry));$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$      negotiated bigint, neg_status text, assurance boolean
    ) ON COMMIT DROP;$old$,
  $new$      negotiated bigint, neg_status text, assurance boolean, offer_id uuid
    ) ON COMMIT DROP;$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$          public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status), coalesce((v_entry->>'hasAssurance')::boolean,false)
        );$old$,
  $new$          public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status), coalesce((v_entry->>'hasAssurance')::boolean,false),
          public.commerce_cart_parse_offer_id(v_entry)
        );$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid$old$,
  $new$AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid
          AND w.offer_id IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(v_entry)$new$,
  2
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$AND w.voucher_award IS NOT DISTINCT FROM l.voucher_award_id$old$,
  $new$AND w.voucher_award IS NOT DISTINCT FROM l.voucher_award_id
        AND w.offer_id IS NOT DISTINCT FROM l.offer_id$new$,
  3
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$      last_unit_price_minor, has_assurance, assurance_rate
    )
    SELECT v_merchant, p_cart_id, w.product_id, w.variant_id, w.condition, w.options,$old$,
  $new$      last_unit_price_minor, has_assurance, assurance_rate, offer_id
    )
    SELECT v_merchant, p_cart_id, w.product_id, w.variant_id, w.condition, w.options,$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$      public.commerce_cart_offer_price_minor(v_merchant, w.product_id, w.variant_id, w.condition), w.assurance, CASE WHEN w.assurance THEN 0.05 ELSE NULL END
    FROM cart_replace_want w$old$,
  $new$      public.commerce_cart_offer_price_minor(v_merchant, w.product_id, w.variant_id, w.condition, w.offer_id), w.assurance, CASE WHEN w.assurance THEN 0.05 ELSE NULL END,
      w.offer_id
    FROM cart_replace_want w$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$THEN public.commerce_cart_offer_price_minor(v_merchant, v_line.product_id, v_line.variant_id, v_line.condition) ELSE v_line.last_unit_price_minor END$old$,
  $new$THEN public.commerce_cart_offer_price_minor(v_merchant, v_line.product_id, v_line.variant_id, v_line.condition, v_line.offer_id) ELSE v_line.last_unit_price_minor END$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$OR v_negotiated >= public.commerce_cart_offer_price_minor(v_merchant, v_line.product_id, v_line.variant_id, v_line.condition) THEN$old$,
  $new$OR v_negotiated >= public.commerce_cart_offer_price_minor(v_merchant, v_line.product_id, v_line.variant_id, v_line.condition, v_line.offer_id) THEN$new$,
  1
);

-- Authoritative snapshot and checkout review expose the stored offer.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_assemble_state(uuid,uuid)',
  $old$        'productId', l.product_id,
        'variantId', l.variant_id,$old$,
  $new$        'productId', l.product_id,
        'offerId', l.offer_id,
        'variantId', l.variant_id,$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_assemble_state(uuid,uuid)',
  $old$public.commerce_cart_offer_price_minor(p_merchant_id,l.product_id,l.variant_id,l.condition)$old$,
  $new$public.commerce_cart_offer_price_minor(p_merchant_id,l.product_id,l.variant_id,l.condition,l.offer_id)$new$,
  2
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_build_checkout_snapshot(uuid,uuid)',
  $old$      l.condition AS condition,
      l.options AS options,$old$,
  $new$      l.condition AS condition,
      l.offer_id AS offer_id,
      l.options AS options,$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_build_checkout_snapshot(uuid,uuid)',
  $old$      product_id,
      variant_id,
      condition,
      options,
      quantity,$old$,
  $new$      product_id,
      variant_id,
      condition,
      offer_id,
      options,
      quantity,$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_build_checkout_snapshot(uuid,uuid)',
  $old$        'productId', product_id,
        'variantId', variant_id,$old$,
  $new$        'productId', product_id,
        'offerId', offer_id,
        'variantId', variant_id,$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_build_checkout_snapshot(uuid,uuid)',
  $old$LEFT JOIN public.product_offers offer ON l.variant_id IS NULL AND l.condition IS NOT NULL AND offer.product_id=l.product_id AND offer.merchant_id=p_merchant_id AND offer.condition=l.condition AND offer.status='active'$old$,
  $new$LEFT JOIN public.product_offers offer ON offer.product_id=l.product_id AND offer.merchant_id=p_merchant_id AND offer.status='active' AND ((l.offer_id IS NOT NULL AND offer.id=l.offer_id) OR (l.offer_id IS NULL AND l.variant_id IS NULL AND l.condition IS NOT NULL AND offer.condition=l.condition))$new$,
  1
);

-- Create and legacy import keep the same identity as add.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_create_device_impl(text,jsonb,text)',
  $old$    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);$old$,
  $new$    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
    PERFORM public.commerce_cart_require_exact_offer(v_merchant, v_product_id, v_condition, public.commerce_cart_parse_offer_id(v_line));$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_create_device_impl(text,jsonb,text)',
  $old$      AND voucher_award_id IS NOT DISTINCT FROM
        (CASE WHEN v_voucher_award IS NULL THEN NULL ELSE v_voucher_award::uuid END);$old$,
  $new$      AND voucher_award_id IS NOT DISTINCT FROM
        (CASE WHEN v_voucher_award IS NULL THEN NULL ELSE v_voucher_award::uuid END)
      AND offer_id IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(v_line);$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_create_device_impl(text,jsonb,text)',
  $old$      INSERT INTO public.commerce_cart_lines (
        merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
        negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
        last_unit_price_minor, has_assurance, assurance_rate
      ) VALUES (
        v_merchant, v_cart_id, v_product_id, v_variant_id, v_condition, v_options,
        CASE WHEN v_voucher_token IS NOT NULL AND v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status),
        v_voucher_token, CASE WHEN v_voucher_award IS NULL THEN NULL ELSE v_voucher_award::uuid END,
        public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id, v_condition), coalesce((v_line->>'hasAssurance')::boolean,false), CASE WHEN coalesce((v_line->>'hasAssurance')::boolean,false) THEN 0.05 ELSE NULL END
      );$old$,
  $new$      INSERT INTO public.commerce_cart_lines (
        merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
        negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
        last_unit_price_minor, has_assurance, assurance_rate, offer_id
      ) VALUES (
        v_merchant, v_cart_id, v_product_id, v_variant_id, v_condition, v_options,
        CASE WHEN v_voucher_token IS NOT NULL AND v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status),
        v_voucher_token, CASE WHEN v_voucher_award IS NULL THEN NULL ELSE v_voucher_award::uuid END,
        public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id, v_condition, public.commerce_cart_parse_offer_id(v_line)), coalesce((v_line->>'hasAssurance')::boolean,false), CASE WHEN coalesce((v_line->>'hasAssurance')::boolean,false) THEN 0.05 ELSE NULL END,
        public.commerce_cart_parse_offer_id(v_line)
      );$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_migrate_legacy_owner_impl(text,text,text,jsonb,text,text)',
  $old$    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);$old$,
  $new$    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
    PERFORM public.commerce_cart_require_exact_offer(v_merchant, v_product_id, v_condition, public.commerce_cart_parse_offer_id(v_line));$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_migrate_legacy_owner_impl(text,text,text,jsonb,text,text)',
  $old$    quantity integer, voucher_token text, voucher_award uuid,
    negotiated bigint, neg_status text, assurance boolean
  ) ON COMMIT DROP;$old$,
  $new$    quantity integer, voucher_token text, voucher_award uuid,
    negotiated bigint, neg_status text, assurance boolean, offer_id uuid
  ) ON COMMIT DROP;$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_migrate_legacy_owner_impl(text,text,text,jsonb,text,text)',
  $old$      AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid;$old$,
  $new$      AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid
      AND w.offer_id IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(v_line);$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_migrate_legacy_owner_impl(text,text,text,jsonb,text,text)',
  $old$        public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status), coalesce((v_line->>'hasAssurance')::boolean,false)
      );$old$,
  $new$        public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status), coalesce((v_line->>'hasAssurance')::boolean,false),
        public.commerce_cart_parse_offer_id(v_line)
      );$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_migrate_legacy_owner_impl(text,text,text,jsonb,text,text)',
  $old$    last_unit_price_minor, has_assurance, assurance_rate
  )
  SELECT v_merchant, v_cart_id, w.product_id, w.variant_id, w.condition, w.options,$old$,
  $new$    last_unit_price_minor, has_assurance, assurance_rate, offer_id
  )
  SELECT v_merchant, v_cart_id, w.product_id, w.variant_id, w.condition, w.options,$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_migrate_legacy_owner_impl(text,text,text,jsonb,text,text)',
  $old$    public.commerce_cart_offer_price_minor(v_merchant, w.product_id, w.variant_id, w.condition), w.assurance, CASE WHEN w.assurance THEN 0.05 ELSE NULL END
  FROM cart_migrate_want w;$old$,
  $new$    public.commerce_cart_offer_price_minor(v_merchant, w.product_id, w.variant_id, w.condition, w.offer_id), w.assurance, CASE WHEN w.assurance THEN 0.05 ELSE NULL END,
    w.offer_id
  FROM cart_migrate_want w;$new$,
  1
);

-- Handoff merge must not collapse two exact offers into one condition lane.
-- Live duplicate predicate gained attachment lanes in 20261015143000.
-- Offer is base identity, so it sits beside options, ahead of those lanes.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$        AND (s.value -> 'options') = v_options
        AND (NOT v_attachment_lanes OR (
          (s.value ->> 'voucherToken') IS NOT DISTINCT FROM v_voucher_token
          AND (s.value ->> 'voucherAward') IS NOT DISTINCT FROM v_voucher_award
          AND (s.value ->> 'negotiated') IS NOT DISTINCT FROM v_negotiated::text
          AND (s.value ->> 'negStatus') IS NOT DISTINCT FROM v_neg_status))
    ) THEN$old$,
  $new$        AND (s.value -> 'options') = v_options
        AND (s.value ->> 'offerId') IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(v_line)::text
        AND (NOT v_attachment_lanes OR (
          (s.value ->> 'voucherToken') IS NOT DISTINCT FROM v_voucher_token
          AND (s.value ->> 'voucherAward') IS NOT DISTINCT FROM v_voucher_award
          AND (s.value ->> 'negotiated') IS NOT DISTINCT FROM v_negotiated::text
          AND (s.value ->> 'negStatus') IS NOT DISTINCT FROM v_neg_status))
    ) THEN$new$,
  1
);

-- A source line id must name the same offer the command submitted.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$        AND coalesce(l.options,'{}'::jsonb)=v_options;
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid_line' USING ERRCODE='P0001'; END IF;$old$,
  $new$        AND coalesce(l.options,'{}'::jsonb)=v_options
        AND l.offer_id IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(v_line);
      IF NOT FOUND THEN RAISE EXCEPTION 'invalid_line' USING ERRCODE='P0001'; END IF;$new$,
  1
);

-- Conflict payload and keep-selection must name the offer, or a resolution
-- for one spelling would satisfy the other.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$          'item', jsonb_build_object('productId', v_product_id, 'variantId', v_variant_id,
            'condition', v_condition, 'options', v_options),$old$,
  $new$          'item', jsonb_build_object('productId', v_product_id, 'variantId', v_variant_id,
            'condition', v_condition, 'options', v_options,
            'offerId', public.commerce_cart_parse_offer_id(v_line)),$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$          AND coalesce(v_resolution -> 'item' -> 'options', '{}'::jsonb) = v_options
          AND (v_resolution ->> 'keep') IN ('incoming', 'existing') THEN$old$,
  $new$          AND coalesce(v_resolution -> 'item' -> 'options', '{}'::jsonb) = v_options
          AND (v_resolution -> 'item' ->> 'offerId') IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(v_line)::text
          AND (v_resolution ->> 'keep') IN ('incoming', 'existing') THEN$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$      AND coalesce(l.options, '{}'::jsonb) = v_options
      AND (NOT v_attachment_lanes OR ($old$,
  $new$      AND coalesce(l.options, '{}'::jsonb) = v_options
      AND l.offer_id IS NOT DISTINCT FROM public.commerce_cart_parse_offer_id(v_line)
      AND (NOT v_attachment_lanes OR ($new$,
  2
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$      'assuranceRate', v_assurance_rate);$old$,
  $new$      'assuranceRate', v_assurance_rate,
      'offerId', public.commerce_cart_parse_offer_id(v_line));$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$        AND (s.value -> 'options') = coalesce(v_resolution -> 'item' -> 'options', '{}'::jsonb)$old$,
  $new$        AND (s.value -> 'options') = coalesce(v_resolution -> 'item' -> 'options', '{}'::jsonb)
        AND (s.value ->> 'offerId') IS NOT DISTINCT FROM (v_resolution -> 'item' ->> 'offerId')$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$    PERFORM public.commerce_cart_require_offer(v_merchant,
      (v_line ->> 'product')::uuid,
      CASE WHEN v_line ->> 'variant' IS NULL THEN NULL ELSE (v_line ->> 'variant')::uuid END,
      v_line ->> 'condition');$old$,
  $new$    PERFORM public.commerce_cart_require_offer(v_merchant,
      (v_line ->> 'product')::uuid,
      CASE WHEN v_line ->> 'variant' IS NULL THEN NULL ELSE (v_line ->> 'variant')::uuid END,
      v_line ->> 'condition');
    PERFORM public.commerce_cart_require_exact_offer(v_merchant,
      (v_line ->> 'product')::uuid,
      v_line ->> 'condition',
      CASE WHEN nullif(v_line ->> 'offerId', '') IS NULL THEN NULL ELSE (v_line ->> 'offerId')::uuid END);$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$      has_assurance, assurance_rate, last_unit_price_minor
    ) VALUES ($old$,
  $new$      has_assurance, assurance_rate, last_unit_price_minor, offer_id
    ) VALUES ($new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$      public.commerce_cart_offer_price_minor(v_merchant,
        (v_line ->> 'product')::uuid,
        CASE WHEN v_line ->> 'variant' IS NULL THEN NULL ELSE (v_line ->> 'variant')::uuid END,
      v_line ->> 'condition')
    );$old$,
  $new$      public.commerce_cart_offer_price_minor(v_merchant,
        (v_line ->> 'product')::uuid,
        CASE WHEN v_line ->> 'variant' IS NULL THEN NULL ELSE (v_line ->> 'variant')::uuid END,
      v_line ->> 'condition',
      CASE WHEN nullif(v_line ->> 'offerId', '') IS NULL THEN NULL ELSE (v_line ->> 'offerId')::uuid END),
      CASE WHEN nullif(v_line ->> 'offerId', '') IS NULL THEN NULL ELSE (v_line ->> 'offerId')::uuid END
    );$new$,
  1
);

-- Redemption coverage treats a different offer as a different line.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$      AND coalesce(line->'item'->'options','{}'::jsonb)=coalesce(l.options,'{}'::jsonb))) THEN$old$,
  $new$      AND coalesce(line->'item'->'options','{}'::jsonb)=coalesce(l.options,'{}'::jsonb)
      AND nullif(line->'item'->>'offerId','') IS NOT DISTINCT FROM l.offer_id::text))) THEN$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$        AND sibling.condition IS NOT DISTINCT FROM l.condition AND sibling.options=l.options$old$,
  $new$        AND sibling.condition IS NOT DISTINCT FROM l.condition AND sibling.options=l.options
        AND sibling.offer_id IS NOT DISTINCT FROM l.offer_id$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$        AND parsed.pi_condition IS NOT DISTINCT FROM l.condition AND parsed.pi_options=coalesce(l.options,'{}'::jsonb)$old$,
  $new$        AND parsed.pi_condition IS NOT DISTINCT FROM l.condition AND parsed.pi_options=coalesce(l.options,'{}'::jsonb)
        AND public.commerce_cart_parse_offer_id(line) IS NOT DISTINCT FROM l.offer_id$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
  $old$            AND selected.condition IS NOT DISTINCT FROM l.condition AND selected.options=l.options$old$,
  $new$            AND selected.condition IS NOT DISTINCT FROM l.condition AND selected.options=l.options
            AND selected.offer_id IS NOT DISTINCT FROM l.offer_id$new$,
  1
);
