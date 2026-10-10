-- Append-only: canonicalize request contacts before budget enforcement.
--
-- Duplicate suppression and the per-contact hourly budget compared
-- lower(contact) as raw strings, so equivalent phone spellings ('+234 801
-- 234 5678' vs '+234-801-234-5678') bypassed both and generated repeat
-- inbox notifications until the broader merchant/IP limits. Comparison
-- keys now come from a normalizer: email-shaped contacts keep lowercase
-- (established behavior), everything else collapses to digits. Stored
-- contact values are untouched (the merchant inbox still shows what the
-- shopper typed); validation, idempotency, grants, and budgets are
-- otherwise unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION storefront_search_private.normalize_request_contact_key(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN raw ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN lower(raw)
    ELSE regexp_replace(COALESCE(raw, ''), '[^0-9]', '', 'g')
  END
$$;

CREATE OR REPLACE FUNCTION public.submit_storefront_product_request(p_merchant_slug text, p_query text, p_contact text, p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_merchant uuid; v_existing public.storefront_product_requests; v_query text := btrim(p_query); v_contact text := btrim(p_contact); v_contact_key text;
BEGIN
  IF p_request_id IS NULL OR v_query IS NULL OR char_length(v_query) NOT BETWEEN 2 AND 120 OR v_query !~ '[[:alnum:]]'
    OR v_contact IS NULL OR char_length(v_contact) NOT BETWEEN 5 AND 160
    OR NOT (v_contact ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR (v_contact ~ '^\+?[0-9 ()-]{7,25}$' AND char_length(regexp_replace(v_contact, '[^0-9]', '', 'g')) >= 7)) THEN
    RAISE EXCEPTION 'Invalid product request' USING ERRCODE = '22023';
  END IF;
  v_contact_key := storefront_search_private.normalize_request_contact_key(v_contact);
  SELECT id INTO v_merchant FROM public.merchants WHERE slug = p_merchant_slug AND (COALESCE(is_published, FALSE) IS TRUE OR COALESCE(is_platform_admin, FALSE) IS TRUE) AND user_id IS NOT NULL;
  IF v_merchant IS NULL THEN RAISE EXCEPTION 'Store unavailable' USING ERRCODE = '22023'; END IF;
  -- Serialize rates and duplicate submissions for this merchant, including concurrent calls.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_merchant::text, 0));
  SELECT id, merchant_id, query, contact, created_at, delivered_at, notification_id INTO v_existing FROM public.storefront_product_requests WHERE id = p_request_id;
  IF FOUND THEN
    IF v_existing.merchant_id = v_merchant AND v_existing.query = v_query AND v_existing.contact = v_contact THEN RETURN; END IF;
    RAISE EXCEPTION 'Request conflict' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.storefront_product_requests WHERE merchant_id = v_merchant AND storefront_search_private.normalize_request_contact_key(contact) = v_contact_key AND lower(query) = lower(v_query) AND created_at > now() - interval '24 hours') THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.storefront_product_requests WHERE merchant_id = v_merchant AND created_at > now() - interval '1 hour') >= 50
    OR (SELECT count(*) FROM public.storefront_product_requests WHERE merchant_id = v_merchant AND storefront_search_private.normalize_request_contact_key(contact) = v_contact_key AND created_at > now() - interval '1 hour') >= 3 THEN
    RAISE EXCEPTION 'Request limit reached' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.storefront_product_requests(id, merchant_id, query, contact) VALUES (p_request_id, v_merchant, v_query, v_contact);
END; $$;;

COMMIT;
