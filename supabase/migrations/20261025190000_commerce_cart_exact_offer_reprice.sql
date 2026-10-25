-- A second add, a replace of an existing line, and the negotiation
-- auto-accept band still priced from the condition spelling. The cart
-- stores new/used/open_box/refurbished, while product_offers.condition is
-- the merchant's raw spelling, so "Used" was remembered at the "used"
-- row's price or at the base product price.

CREATE OR REPLACE FUNCTION public.commerce_cart_negotiation_status(
  p_merchant_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_condition text,
  p_negotiated bigint,
  p_requested text,
  p_offer_id uuid
) RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  catalog bigint := public.commerce_cart_offer_price_minor(
    p_merchant_id, p_product_id, p_variant_id, p_condition, p_offer_id
  );
BEGIN
  IF p_negotiated IS NULL THEN RETURN NULL; END IF;
  IF p_requested = 'rejected' THEN RETURN 'rejected'; END IF;
  IF p_requested = 'pending' THEN RETURN 'pending'; END IF;
  IF public.commerce_cart_product_negotiable(p_merchant_id, p_product_id)
    AND p_negotiated > 0
    AND p_negotiated < catalog
    AND (catalog - p_negotiated)::numeric * 100 <= catalog::numeric * 2 THEN
    RETURN 'accepted';
  END IF;
  RETURN 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_cart_negotiation_status(uuid, uuid, uuid, text, bigint, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

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
    RAISE EXCEPTION 'empty cart offer reprice patch for %', signature;
  END IF;
  found := (length(definition) - length(replace(definition, old, ''))) / length(old);
  IF found <> expected THEN
    RAISE EXCEPTION 'cart offer reprice source mismatch for % expected % found %', signature, expected, found;
  END IF;
  EXECUTE replace(definition, old, replacement);
END;
$fn$;

-- Merging another add of the same offer keeps that offer's price.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$        last_unit_price_minor = public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id, v_condition),
        updated_at = now()
      WHERE id = v_line.id;$old$,
  $new$        last_unit_price_minor = public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id, v_condition, v_line.offer_id),
        updated_at = now()
      WHERE id = v_line.id;$new$,
  1
);

-- The status computed before the merge match uses the same offer.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$    v_neg_status:=public.commerce_cart_negotiation_status(v_merchant,v_product_id,v_variant_id,v_condition,v_negotiated,v_neg_status);$old$,
  $new$    v_neg_status:=public.commerce_cart_negotiation_status(v_merchant,v_product_id,v_variant_id,v_condition,v_negotiated,v_neg_status,public.commerce_cart_parse_offer_id(p_command));$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status),
        v_voucher_token, v_voucher_award::uuid,$old$,
  $new$        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status, public.commerce_cart_parse_offer_id(p_command)),
        v_voucher_token, v_voucher_award::uuid,$new$,
  1
);

-- Replacing an existing line reprices that line's own offer.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$      last_unit_price_minor = public.commerce_cart_offer_price_minor(v_merchant, l.product_id, l.variant_id, l.condition),
      updated_at = now()$old$,
  $new$      last_unit_price_minor = public.commerce_cart_offer_price_minor(v_merchant, l.product_id, l.variant_id, l.condition, l.offer_id),
      updated_at = now()$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$      v_neg_status := public.commerce_cart_negotiation_status(v_merchant,v_product_id,v_variant_id,v_condition,v_negotiated,v_neg_status);$old$,
  $new$      v_neg_status := public.commerce_cart_negotiation_status(v_merchant,v_product_id,v_variant_id,v_condition,v_negotiated,v_neg_status,public.commerce_cart_parse_offer_id(v_entry));$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$          public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status), coalesce((v_entry->>'hasAssurance')::boolean,false),$old$,
  $new$          public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status, public.commerce_cart_parse_offer_id(v_entry)), coalesce((v_entry->>'hasAssurance')::boolean,false),$new$,
  1
);

-- Setting a negotiated price on a stored line uses that line's offer.
SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)',
  $old$        ELSE public.commerce_cart_negotiation_status(v_merchant,v_line.product_id,v_line.variant_id,v_line.condition,v_negotiated,NULL) END,$old$,
  $new$        ELSE public.commerce_cart_negotiation_status(v_merchant,v_line.product_id,v_line.variant_id,v_line.condition,v_negotiated,NULL,v_line.offer_id) END,$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_create_device_impl(text,jsonb,text)',
  $old$        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status),
        v_voucher_token, CASE WHEN v_voucher_award IS NULL THEN NULL ELSE v_voucher_award::uuid END,$old$,
  $new$        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status, public.commerce_cart_parse_offer_id(v_line)),
        v_voucher_token, CASE WHEN v_voucher_award IS NULL THEN NULL ELSE v_voucher_award::uuid END,$new$,
  1
);

SELECT pg_temp.patch_cart_fn(
  'public.commerce_cart_migrate_legacy_owner_impl(text,text,text,jsonb,text,text)',
  $old$        public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status), coalesce((v_line->>'hasAssurance')::boolean,false),$old$,
  $new$        public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_condition, v_negotiated, v_neg_status, public.commerce_cart_parse_offer_id(v_line)), coalesce((v_line->>'hasAssurance')::boolean,false),$new$,
  1
);
