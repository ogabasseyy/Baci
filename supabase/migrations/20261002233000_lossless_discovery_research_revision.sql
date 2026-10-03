-- Compute the research revision in PostgreSQL, before JSONB numbers reach JavaScript.
CREATE SCHEMA IF NOT EXISTS discovery_review_private;
REVOKE ALL ON SCHEMA discovery_review_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA discovery_review_private TO authenticated;
CREATE OR REPLACE FUNCTION discovery_review_private.research_revision(
  p_name text, p_category text, p_metadata jsonb, p_specifications jsonb,
  p_mpn text, p_color text, p_discovery_metadata jsonb
) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('name',p_name,'category',p_category,
      'metadata',p_metadata,'specifications',p_specifications,'mpn',p_mpn,
      'color',p_color,'discovery_metadata',p_discovery_metadata)::text, 'UTF8'
  )), 'hex');
$$;
REVOKE ALL ON FUNCTION discovery_review_private.research_revision(text,text,jsonb,jsonb,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION discovery_review_private.research_revision(text,text,jsonb,jsonb,text,text,jsonb) TO authenticated;

-- Source fields and their revision come from the same MVCC statement.
CREATE OR REPLACE FUNCTION public.get_product_discovery_research_page(
  p_merchant_id uuid, p_cursor uuid DEFAULT NULL
) RETURNS TABLE(product jsonb, revision text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT pg_catalog.jsonb_build_object('id',p.id,'name',p.name,
    'category',p.category,'metadata',p.metadata,'discovery_metadata',p.discovery_metadata,
    'specifications',p.specifications,'mpn',p.mpn,'color',p.color),
    discovery_review_private.research_revision(p.name,p.category,p.metadata,
      p.specifications,p.mpn,p.color,p.discovery_metadata)
  FROM public.products p
  WHERE p.merchant_id=p_merchant_id AND (p_cursor IS NULL OR p.id>p_cursor)
  ORDER BY p.id LIMIT 21;
$$;
REVOKE ALL ON FUNCTION public.get_product_discovery_research_page(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_discovery_research_page(uuid,uuid) TO authenticated;

-- Replace the JSON snapshot overload, with no precision-losing fallback path.
DROP FUNCTION IF EXISTS public.update_product_discovery_metadata_guarded(uuid,uuid,jsonb,jsonb,jsonb);
CREATE OR REPLACE FUNCTION public.update_product_discovery_metadata_guarded(
  p_product_id uuid, p_merchant_id uuid, p_metadata jsonb, p_expected_revision text
) RETURNS TABLE(id uuid)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.products p SET discovery_metadata=p_metadata
  WHERE p.id=p_product_id AND p.merchant_id=p_merchant_id
    AND discovery_review_private.research_revision(p.name,p.category,p.metadata,
      p.specifications,p.mpn,p.color,p.discovery_metadata)=p_expected_revision
  RETURNING p.id;
$$;
REVOKE ALL ON FUNCTION public.update_product_discovery_metadata_guarded(uuid,uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_discovery_metadata_guarded(uuid,uuid,jsonb,text) TO authenticated;
