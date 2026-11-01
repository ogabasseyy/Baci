-- REDVAULT must create its draft and complete the reviewed shared cart in
-- the same transaction. Extend the installed cart authority function so all
-- existing ownership, snapshot and grant checks continue to run unchanged.
DO $migration$
DECLARE
  v_definition text := pg_get_functiondef(
    'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)'::regprocedure
  );
  v_anchor text;
  v_replacement text;
BEGIN
  v_anchor := $old$p_variant NOT IN ('base', 'savings', 'quiz_voucher', 'discount_code', 'loyalty_code')$old$;
  v_replacement := $new$p_variant NOT IN ('base', 'savings', 'quiz_voucher', 'discount_code', 'loyalty_code', 'redvault')$new$;
  IF (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'REDVAULT binding variant anchor missing or ambiguous';
  END IF;
  v_definition := replace(v_definition, v_anchor, v_replacement);

  v_anchor := $old$  v_order record;$old$;
  IF (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'REDVAULT binding declaration anchor missing or ambiguous';
  END IF;
  v_definition := replace(v_definition, v_anchor, v_anchor || E'\n  v_redvault_replay record;');

  v_anchor := $old$  v_merchant := nullif(p_args ->> 'p_merchant_id', '')::uuid;$old$;
  v_replacement := $new$  -- REDVAULT is only reachable from the proof-signing storefront route.
  -- Bind its signed order to exactly the items that will be reviewed below.
  -- Condition and variant attributes are normalized from the verified quote;
  -- explicitly reviewed conditions and variant choices must still agree.
  -- Every other item field must remain identical and in the same order.
  IF p_variant = 'redvault' THEN
    IF v_context IS DISTINCT FROM 'route' OR v_role IS DISTINCT FROM 'authenticated' THEN
      RAISE EXCEPTION 'cart_order_unauthorized' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_typeof(p_args -> 'p_items') IS DISTINCT FROM 'array'
      OR jsonb_typeof(p_args -> 'p_redvault_order' -> 'items') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
    END IF;
    IF p_args -> 'p_redvault_order' ->> 'merchant_id' IS DISTINCT FROM p_args ->> 'p_merchant_id'
      OR p_args -> 'p_redvault_order' ->> 'customer_email' IS DISTINCT FROM lower(trim(p_args ->> 'p_customer_email'))
      OR p_args -> 'p_redvault_order' ->> 'payment_method' IS DISTINCT FROM 'uba_redvault'
      OR p_args ->> 'p_payment_method' IS DISTINCT FROM 'uba_redvault'
      OR nullif(p_args ->> 'p_checkout_idempotency_key', '') IS NULL
      OR p_args -> 'p_redvault_order' ->> 'checkout_idempotency_key' IS DISTINCT FROM p_args ->> 'p_checkout_idempotency_key'
      OR (SELECT jsonb_agg(item - 'condition' - 'variant_attributes' ORDER BY ord)
          FROM jsonb_array_elements(p_args -> 'p_items') WITH ORDINALITY AS submitted(item, ord))
         IS DISTINCT FROM
         (SELECT jsonb_agg(item - 'condition' - 'variant_attributes' ORDER BY ord)
          FROM jsonb_array_elements(p_args -> 'p_redvault_order' -> 'items') WITH ORDINALITY AS signed(item, ord)) THEN
      RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_args -> 'p_items') WITH ORDINALITY AS submitted(item, ord)
      JOIN jsonb_array_elements(p_args -> 'p_redvault_order' -> 'items') WITH ORDINALITY AS signed(item, ord)
        ON signed.ord = submitted.ord
      WHERE (nullif(submitted.item ->> 'condition', '') IS NOT NULL
          AND discovery.canonical_product_condition(submitted.item ->> 'condition')
            IS DISTINCT FROM discovery.canonical_product_condition(signed.item ->> 'condition'))
        OR (nullif(submitted.item ->> 'variant_id', '') IS NOT NULL
          AND NOT coalesce(signed.item -> 'variant_attributes', '{}'::jsonb)
            @> coalesce(submitted.item -> 'variant_attributes', '{}'::jsonb))
    ) THEN
      RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  v_merchant := nullif(p_args ->> 'p_merchant_id', '')::uuid;$new$;
  IF (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'REDVAULT binding identity anchor missing or ambiguous';
  END IF;
  v_definition := replace(v_definition, v_anchor, v_replacement);

  v_anchor := $old$    RETURN pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(v_session.result, '{replayed}', 'true', true),$old$;
  v_replacement := $new$    -- A receipt from another payment variant cannot be reused as REDVAULT,
    -- nor can a REDVAULT receipt be reused as another order type. For a
    -- REDVAULT replay, verify the signed request and existing unpaid draft
    -- again before returning the stored receipt.
    IF p_variant = 'redvault' OR v_session.result -> 'binding' ->> 'variant' = 'redvault' THEN
      IF p_variant IS DISTINCT FROM v_session.result -> 'binding' ->> 'variant' THEN
        RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
      END IF;
      SELECT * INTO STRICT v_redvault_replay
      FROM public.create_storefront_redvault_order(
        p_args -> 'p_redvault_order', p_args -> 'p_redvault_quote', p_args -> 'p_redvault_route_proof'
      );
      IF v_redvault_replay.id IS DISTINCT FROM v_session.order_id
        OR v_redvault_replay.status IS DISTINCT FROM 'pending'
        OR v_redvault_replay.idempotency_replayed IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(v_session.result, '{replayed}', 'true', true),$new$;
  IF (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'REDVAULT binding replay anchor missing or ambiguous';
  END IF;
  v_definition := replace(v_definition, v_anchor, v_replacement);

  v_anchor := $old$  ELSIF p_variant = 'savings' THEN$old$;
  v_replacement := $new$  ELSIF p_variant = 'redvault' THEN
    SELECT * INTO STRICT v_order
    FROM public.create_storefront_redvault_order(
      p_args -> 'p_redvault_order', p_args -> 'p_redvault_quote', p_args -> 'p_redvault_route_proof'
    );
    -- A draft already attached elsewhere must never complete a new cart.
    IF v_order.status IS DISTINCT FROM 'pending'
      OR v_order.idempotency_replayed IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_variant = 'savings' THEN$new$;
  IF (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'REDVAULT binding dispatch anchor missing or ambiguous';
  END IF;
  v_definition := replace(v_definition, v_anchor, v_replacement);
  EXECUTE v_definition;
END;
$migration$;
