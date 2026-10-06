BEGIN;
CREATE FUNCTION savings_draft_private.view(p_draft public.customer_savings_drafts)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'draftId', p_draft.id, 'requestId', p_draft.request_id, 'revisionId', p_draft.revision_id,
    'productId', p_draft.product_id, 'variantId', p_draft.variant_id, 'catalogue', p_draft.catalogue,
    'createdAt', p_draft.created_at, 'acceptedAt', p_draft.accepted_at,
    'terms', jsonb_build_object('version', document.version, 'hash', document.sha256, 'text', document.content)
  ) FROM savings_draft_private.documents document
    WHERE document.version = p_draft.terms_version AND document.sha256 = p_draft.terms_hash;
$$;
REVOKE ALL ON FUNCTION savings_draft_private.view(public.customer_savings_drafts) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION savings_draft_private.catalogue(p_merchant uuid, p_product uuid, p_variant uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE product public.products%ROWTYPE; variants jsonb; selected_variant jsonb; price numeric;
BEGIN
  SELECT products.id, products.name, products.price, products.images, products.condition, products.has_variants
    INTO product.id, product.name, product.price, product.images, product.condition, product.has_variants
    FROM public.products products
    WHERE products.id = p_product AND products.merchant_id = p_merchant AND products.status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device unavailable' USING ERRCODE = 'P0002'; END IF;
  PERFORM variant.id FROM public.product_variants variant WHERE variant.product_id = product.id FOR SHARE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', variant.id, 'condition', variant.condition,
    'sku', variant.sku, 'price_override', variant.price_override, 'primary_image', variant.primary_image,
    'images', variant.images, 'attributes', variant.attributes)), '[]'::jsonb) INTO variants
    FROM public.get_storefront_product_variants(ARRAY[product.id]) variant;
  IF p_variant IS NULL AND (jsonb_array_length(variants) > 0 OR product.has_variants IS TRUE) THEN
    RAISE EXCEPTION 'Exact variant required' USING ERRCODE = '22023';
  END IF;
  IF p_variant IS NOT NULL THEN
    SELECT value INTO selected_variant FROM jsonb_array_elements(variants) WHERE (value->>'id')::uuid = p_variant;
    IF selected_variant IS NULL THEN RAISE EXCEPTION 'Device unavailable' USING ERRCODE = 'P0002'; END IF;
  END IF;
  price := COALESCE((selected_variant->>'price_override')::numeric, product.price);
  IF price IS NULL OR price <= 0 OR price::text IN ('NaN','Infinity','-Infinity')
    OR length(btrim(COALESCE(selected_variant->>'condition', product.condition))) NOT BETWEEN 1 AND 100
    OR COALESCE(selected_variant->>'condition', product.condition) IS NULL
    OR length(btrim(product.name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Device unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN jsonb_build_object('id', product.id, 'name', product.name, 'price', product.price,
    'images', product.images, 'condition', product.condition,
    'variants', CASE WHEN p_variant IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(selected_variant) END);
END;
$$;
REVOKE ALL ON FUNCTION savings_draft_private.catalogue(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.customer_savings_draft_command(p_merchant_id uuid, p_action text, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid(); scoped_customer_id uuid; config savings_draft_private.settings%ROWTYPE;
  saved public.customer_savings_drafts%ROWTYPE;
  selected_request_id uuid; selected_product_id uuid; selected_variant_id uuid; selected_draft_id uuid;
  catalogue jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  BEGIN
    SELECT customer.id INTO STRICT scoped_customer_id FROM public.customers customer
      WHERE customer.user_id = actor AND customer.merchant_id = p_merchant_id FOR SHARE;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'Draft unavailable' USING ERRCODE = '42501';
  END;
  IF scoped_customer_id IS NULL OR NOT savings_draft_private.visible(scoped_customer_id, p_merchant_id) THEN
    RAISE EXCEPTION 'Draft unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM merchant.id FROM public.merchants merchant WHERE merchant.id = p_merchant_id AND merchant.is_published IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE = '42501'; END IF;
  SELECT settings.merchant_id, settings.enabled, settings.environment, settings.terms_version, settings.terms_hash
    INTO config FROM savings_draft_private.settings settings
    WHERE settings.merchant_id = p_merchant_id AND settings.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE = '42501'; END IF;
  IF p_input IS NULL OR jsonb_typeof(p_input) <> 'object' OR octet_length(p_input::text) > 4096
    OR p_action IS NULL OR p_action NOT IN ('create', 'list', 'policy', 'accept') THEN
    RAISE EXCEPTION 'Invalid input' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'list' THEN
    IF p_input - ARRAY['requestId'] <> '{}'::jsonb
      OR (p_input ? 'requestId' AND jsonb_typeof(p_input->'requestId') <> 'string') THEN
      RAISE EXCEPTION 'Invalid input' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('drafts', COALESCE((
      SELECT jsonb_agg(savings_draft_private.view(recent.saved) ORDER BY (recent.saved).created_at DESC, (recent.saved).id)
      FROM (SELECT draft AS saved FROM public.customer_savings_drafts draft
        WHERE draft.customer_id = scoped_customer_id AND draft.merchant_id = p_merchant_id AND draft.actor_id = actor
          AND (NOT p_input ? 'requestId' OR draft.request_id = (p_input->>'requestId')::uuid)
        ORDER BY draft.created_at DESC, draft.id LIMIT 50) recent
    ), '[]'::jsonb));
  END IF;

  IF p_action = 'create' THEN
    IF p_input - ARRAY['productId','variantId','requestId'] <> '{}'::jsonb
      OR NOT p_input ?& ARRAY['productId','variantId','requestId']
      OR jsonb_typeof(p_input->'productId') <> 'string' OR jsonb_typeof(p_input->'requestId') <> 'string'
      OR jsonb_typeof(p_input->'variantId') NOT IN ('string','null') THEN
      RAISE EXCEPTION 'Invalid input' USING ERRCODE = '22023';
    END IF;
    selected_request_id := (p_input->>'requestId')::uuid;
    selected_product_id := (p_input->>'productId')::uuid;
    selected_variant_id := (p_input->>'variantId')::uuid;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_merchant_id::text || scoped_customer_id::text || selected_request_id::text, 0));
    SELECT draft.* INTO saved FROM public.customer_savings_drafts draft
      WHERE draft.merchant_id = p_merchant_id AND draft.customer_id = scoped_customer_id AND draft.request_id = selected_request_id;
    IF FOUND THEN
      IF saved.actor_id <> actor OR saved.product_id <> selected_product_id OR saved.variant_id IS DISTINCT FROM selected_variant_id THEN
        RAISE EXCEPTION 'Draft conflict' USING ERRCODE = '23505';
      END IF;
      RETURN jsonb_build_object('draft', savings_draft_private.view(saved));
    END IF;
    PERFORM 1 FROM piggyvest_goal_policy.terms terms WHERE terms.version = config.terms_version
      AND terms.sha256 = config.terms_hash AND terms.enabled FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Policy unavailable' USING ERRCODE = '23514'; END IF;
    catalogue := savings_draft_private.catalogue(p_merchant_id, selected_product_id, selected_variant_id);
    INSERT INTO public.customer_savings_drafts(merchant_id, customer_id, actor_id, request_id,
      product_id, variant_id, catalogue, terms_version, terms_hash)
      VALUES (p_merchant_id, scoped_customer_id, actor, selected_request_id, selected_product_id, selected_variant_id, catalogue, config.terms_version, config.terms_hash)
      RETURNING * INTO saved;
    RETURN jsonb_build_object('draft', savings_draft_private.view(saved));
  END IF;

  IF (p_action = 'policy' AND (p_input - ARRAY['draftId'] <> '{}'::jsonb OR NOT p_input ? 'draftId'))
    OR (p_action = 'accept' AND (p_input - ARRAY['draftId','revisionId','termsVersion','termsHash','accepted'] <> '{}'::jsonb
      OR NOT p_input ?& ARRAY['draftId','revisionId','termsVersion','termsHash','accepted']
      OR p_input->'accepted' IS DISTINCT FROM 'true'::jsonb
      OR jsonb_typeof(p_input->'revisionId') <> 'string'
      OR jsonb_typeof(p_input->'termsVersion') <> 'string' OR jsonb_typeof(p_input->'termsHash') <> 'string'))
    OR jsonb_typeof(p_input->'draftId') <> 'string' THEN
    RAISE EXCEPTION 'Invalid input' USING ERRCODE = '22023';
  END IF;
  selected_draft_id := (p_input->>'draftId')::uuid;
  SELECT draft.* INTO saved FROM public.customer_savings_drafts draft
    WHERE draft.id = selected_draft_id AND draft.customer_id = scoped_customer_id AND draft.merchant_id = p_merchant_id AND draft.actor_id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE = 'P0002'; END IF;
  IF p_action = 'accept' THEN
    IF saved.revision_id <> (p_input->>'revisionId')::uuid OR saved.terms_version <> p_input->>'termsVersion'
      OR saved.terms_hash <> p_input->>'termsHash' THEN
      RAISE EXCEPTION 'Policy conflict' USING ERRCODE = '23505';
    END IF;
    IF saved.accepted_at IS NULL THEN
      PERFORM 1 FROM piggyvest_goal_policy.terms terms WHERE terms.version = saved.terms_version
        AND terms.sha256 = saved.terms_hash AND terms.enabled FOR SHARE;
      IF NOT FOUND OR config.terms_version <> saved.terms_version OR config.terms_hash <> saved.terms_hash THEN
        RAISE EXCEPTION 'Policy unavailable' USING ERRCODE = '23514';
      END IF;
      BEGIN
        catalogue := savings_draft_private.catalogue(p_merchant_id, saved.product_id, saved.variant_id);
      EXCEPTION WHEN no_data_found OR invalid_parameter_value THEN
        RAISE EXCEPTION 'Device review required' USING ERRCODE = '23514';
      END;
      IF catalogue IS DISTINCT FROM saved.catalogue THEN
        RAISE EXCEPTION 'Device review required' USING ERRCODE = '23514';
      END IF;
      UPDATE public.customer_savings_drafts SET accepted_at = clock_timestamp() WHERE id = saved.id
        RETURNING * INTO saved;
    END IF;
  END IF;
  RETURN jsonb_build_object('draft', savings_draft_private.view(saved));
END;
$$;
REVOKE ALL ON FUNCTION public.customer_savings_draft_command(uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_savings_draft_command(uuid, text, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
