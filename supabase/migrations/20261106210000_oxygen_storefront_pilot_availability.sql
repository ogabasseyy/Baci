-- A display hint only: workflow creation independently enforces admission.
-- Return no partner or customer records to the caller.
CREATE FUNCTION public.oxygen_storefront_pilot_available(p_merchant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM oxygen_private.runtime_bindings b
    JOIN oxygen_private.production_admission_policy p ON p.merchant_id = b.merchant_id
    WHERE b.merchant_id = p_merchant_id
      AND b.enabled AND b.environment = 'production'
      AND (p.mode = 'open' OR (p.mode = 'pilot' AND EXISTS (
        SELECT 1 FROM oxygen_private.production_pilot_customers a
        WHERE a.merchant_id = b.merchant_id AND a.user_id = auth.uid()
      )))
  );
$$;
REVOKE ALL ON FUNCTION public.oxygen_storefront_pilot_available(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oxygen_storefront_pilot_available(uuid) TO authenticated;
