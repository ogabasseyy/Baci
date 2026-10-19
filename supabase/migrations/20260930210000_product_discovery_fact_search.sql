-- Verified facts participate in retrieval independently of marketing text and embeddings.
CREATE INDEX IF NOT EXISTS products_discovery_fact_search_idx ON public.products
USING gin (jsonb_to_tsvector('simple'::regconfig, coalesce(discovery_metadata, '{}'::jsonb), '["string", "numeric"]'::jsonb))
WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.search_product_discovery_facts(
  merchant_id_param uuid,
  query_text text,
  result_limit integer DEFAULT 100,
  result_offset integer DEFAULT 0
)
RETURNS TABLE (product_id uuid, total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT p.id, count(*) OVER ()
  FROM public.products p
  WHERE p.merchant_id = merchant_id_param AND p.status = 'active'
    AND pg_catalog.jsonb_to_tsvector('simple'::regconfig,
      coalesce(p.discovery_metadata, '{}'::jsonb), '["string", "numeric"]'::jsonb)
      @@ pg_catalog.plainto_tsquery('simple'::regconfig, left(query_text, 100))
  ORDER BY p.id
  LIMIT least(greatest(coalesce(result_limit, 100), 1), 100)
  OFFSET least(greatest(coalesce(result_offset, 0), 0), 500);
$$;
REVOKE ALL ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_product_discovery_facts(uuid, text, integer, integer) TO anon, authenticated;
