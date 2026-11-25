-- Open production Oxygen admission for merchants with enabled production
-- runtime bindings, and allow anonymous storefront display-hint queries
-- when a merchant's production admission policy is set to 'open'.
-- Workflow creation (oxygen_private.start_workflow) continues to enforce
-- authenticated customer ownership (auth.uid()).

INSERT INTO oxygen_private.production_admission_policy (merchant_id, mode)
SELECT b.merchant_id, 'open'
FROM oxygen_private.runtime_bindings b
WHERE b.enabled IS TRUE AND b.environment = 'production'
ON CONFLICT (merchant_id) DO UPDATE SET mode = 'open';

CREATE OR REPLACE FUNCTION public.oxygen_storefront_pilot_available(p_merchant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM oxygen_private.runtime_bindings b
    JOIN oxygen_private.production_admission_policy p ON p.merchant_id = b.merchant_id
    WHERE b.merchant_id = p_merchant_id
      AND b.enabled IS TRUE
      AND b.environment = 'production'
      AND (
        p.mode = 'open'
        OR (
          p.mode = 'pilot'
          AND auth.uid() IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM oxygen_private.production_pilot_customers a
            WHERE a.merchant_id = b.merchant_id
              AND a.user_id = auth.uid()
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.oxygen_storefront_pilot_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.oxygen_storefront_pilot_available(uuid) TO anon, authenticated;
