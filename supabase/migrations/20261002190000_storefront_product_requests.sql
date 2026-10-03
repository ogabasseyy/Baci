BEGIN;
CREATE TABLE public.storefront_product_requests (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  query text NOT NULL CHECK (char_length(query) BETWEEN 2 AND 120),
  contact text NOT NULL CHECK (char_length(contact) BETWEEN 5 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  notification_id uuid UNIQUE REFERENCES public.notifications(id) ON DELETE SET NULL
);
CREATE INDEX storefront_product_requests_pending_idx ON public.storefront_product_requests(created_at) WHERE delivered_at IS NULL;
CREATE INDEX storefront_product_requests_merchant_created_idx ON public.storefront_product_requests(merchant_id, created_at DESC);
ALTER TABLE public.storefront_product_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storefront_product_requests FROM anon, authenticated;
GRANT SELECT ON public.storefront_product_requests TO authenticated;
CREATE POLICY product_requests_owner_read ON public.storefront_product_requests FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.user_id = (SELECT auth.uid())));

-- Narrow public intake: no direct writes, private reads or notification content control.
CREATE FUNCTION public.submit_storefront_product_request(p_merchant_slug text, p_query text, p_contact text, p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_merchant uuid; v_existing public.storefront_product_requests; v_query text := btrim(p_query); v_contact text := btrim(p_contact);
BEGIN
  IF p_request_id IS NULL OR v_query IS NULL OR char_length(v_query) NOT BETWEEN 2 AND 120 OR v_query !~ '[[:alnum:]]'
    OR v_contact IS NULL OR char_length(v_contact) NOT BETWEEN 5 AND 160
    OR NOT (v_contact ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR v_contact ~ '^\+?[0-9 ()-]{7,25}$') THEN
    RAISE EXCEPTION 'Invalid product request' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_merchant FROM public.merchants WHERE slug = p_merchant_slug AND is_published = true AND user_id IS NOT NULL;
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
END; $$;
REVOKE ALL ON FUNCTION public.submit_storefront_product_request(text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_storefront_product_request(text,text,text,uuid) TO anon, authenticated;

-- Trusted DB worker delivers durable inbox rows; customer calls cannot mutate platform notifications.
CREATE FUNCTION private.deliver_storefront_product_requests()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_request record; v_notification uuid; v_count integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Worker only' USING ERRCODE = '42501'; END IF;
  FOR v_request IN SELECT r.id, r.merchant_id, r.query, r.contact, m.user_id, COALESCE(p.in_app_enabled, true) AS in_app_enabled FROM public.storefront_product_requests r JOIN public.merchants m ON m.id = r.merchant_id LEFT JOIN public.notification_preferences p ON p.merchant_id = r.merchant_id WHERE r.delivered_at IS NULL ORDER BY r.created_at LIMIT 50 FOR UPDATE OF r SKIP LOCKED LOOP
    INSERT INTO public.notifications(title, message, notification_type, priority, target_type, target_merchant_ids, channels, created_by, is_system, scheduled_for, sent_at, delivery_state)
    VALUES ('Product request', 'A customer requested: ' || v_request.query || E'\nContact: ' || v_request.contact, 'info', 'normal', 'specific', ARRAY[v_request.merchant_id], '["in_app"]'::jsonb, v_request.user_id, true, now(), now(), 'sent') RETURNING id INTO v_notification;
    INSERT INTO public.merchant_notifications(notification_id, merchant_id, in_app_visible, banner_visible) VALUES (v_notification, v_request.merchant_id, v_request.in_app_enabled, false) ON CONFLICT (notification_id, merchant_id) DO NOTHING;
    UPDATE public.storefront_product_requests SET notification_id = v_notification, delivered_at = now() WHERE id = v_request.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION private.deliver_storefront_product_requests() FROM PUBLIC, anon, authenticated, service_role;
SELECT cron.schedule('storefront-product-request-inbox', '* * * * *', 'SELECT private.deliver_storefront_product_requests();');
COMMIT;
