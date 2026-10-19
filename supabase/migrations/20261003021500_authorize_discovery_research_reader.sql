-- Published product SELECT policies also admit authenticated shoppers.
-- Research is a merchant operation: require owner or products/edit staff access
-- in addition to normal product RLS, even when the RPC is called directly.
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
  WHERE p.merchant_id=p_merchant_id
    AND auth.uid() IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.merchants m
      WHERE m.id=p_merchant_id AND m.user_id=auth.uid())
      OR public.check_staff_permission(auth.uid(),p_merchant_id,'products','edit'))
    AND (p_cursor IS NULL OR p.id>p_cursor)
  ORDER BY p.id LIMIT 21;
$$;
REVOKE ALL ON FUNCTION public.get_product_discovery_research_page(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_discovery_research_page(uuid,uuid) TO authenticated;

