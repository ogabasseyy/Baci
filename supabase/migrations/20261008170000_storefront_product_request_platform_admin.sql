-- Append-only: accept product requests for visible platform-admin stores.
--
-- Refined search deliberately exposes unpublished platform-admin
-- storefronts (matching the established projections), so the no-results
-- page renders a request form there — but intake rejected the merchant as
-- unavailable. The lookup now uses the same
-- published-or-platform-admin predicate. Grants are untouched (CREATE OR
-- REPLACE preserves the storefront_intake-only execute grant).
BEGIN;

CREATE OR REPLACE FUNCTION public.submit_storefront_product_request(p_merchant_slug text, p_query text, p_contact text, p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_merchant uuid; v_existing public.storefront_product_requests; v_query text := btrim(p_query); v_contact text := btrim(p_contact);
BEGIN
  IF p_request_id IS NULL OR v_query IS NULL OR char_length(v_query) NOT BETWEEN 2 AND 120 OR v_query !~ '[[:alnum:]]'
    OR v_contact IS NULL OR char_length(v_contact) NOT BETWEEN 5 AND 160
    OR NOT (v_contact ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR (v_contact ~ '^\+?[0-9 ()-]{7,25}$' AND char_length(regexp_replace(v_contact, '[^0-9]', '', 'g')) >= 7)) THEN
    RAISE EXCEPTION 'Invalid product request' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_merchant FROM public.merchants WHERE slug = p_merchant_slug AND (COALESCE(is_published, FALSE) IS TRUE OR COALESCE(is_platform_admin, FALSE) IS TRUE) AND user_id IS NOT NULL;
  IF v_merchant IS NULL THEN RAISE EXCEPTION 'Store unavailable' USING ERRCODE = '22023'; END IF;
  -- Serialize rates and duplicate submissions for this merchant, including concurrent calls.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_merchant::text, 0));
  SELECT id, merchant_id, query, contact, created_at, delivered_at, notification_id INTO v_existing FROM public.storefront_product_requests WHERE id = p_request_id;
  IF FOUND THEN
    IF v_existing.merchant_id = v_merchant AND v_existing.query = v_query AND v_existing.contact = v_contact THEN RETURN; END IF;
    RAISE EXCEPTION 'Request conflict' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.storefront_product_requests WHERE merchant_id = v_merchant AND lower(contact) = lower(v_contact) AND lower(query) = lower(v_query) AND created_at > now() - interval '24 hours') THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.storefront_product_requests WHERE merchant_id = v_merchant AND created_at > now() - interval '1 hour') >= 50
    OR (SELECT count(*) FROM public.storefront_product_requests WHERE merchant_id = v_merchant AND lower(contact) = lower(v_contact) AND created_at > now() - interval '1 hour') >= 3 THEN
    RAISE EXCEPTION 'Request limit reached' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.storefront_product_requests(id, merchant_id, query, contact) VALUES (p_request_id, v_merchant, v_query, v_contact);
END; $$;;

COMMIT;
