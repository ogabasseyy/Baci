-- The cache-invalidation migration replaces the shared pre-request guard.
-- Re-add the already-deployed cart-quota boundary without editing historical
-- migrations, preserving both capabilities in the current guard definition.
DO $quota_scope$
DECLARE
  definition text := pg_get_functiondef(
    'public.enforce_gigl_tracking_worker_request_scope()'::regprocedure
  );
  anchor text := 'IF request_role = ''gigl_tracking_worker'' THEN';
  insertion text := $scope$IF request_role = 'anon' AND request_method = 'POST'
    AND request_path = '/rpc/__commerce_cart_quota_hook_reload_canary__' THEN
    RAISE EXCEPTION 'CART QUOTA hook reload canary observed' USING ERRCODE = '42501';
  END IF;

  IF request_role = 'commerce_cart_quota' THEN
    -- commerce_cart_quota_request_scope_v1
    IF request_method IS DISTINCT FROM 'POST'
      OR request_path IS DISTINCT FROM '/rpc/increment_commerce_cart_quota' THEN
      RAISE EXCEPTION 'Cart quota request is outside its capability scope'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  $scope$;
BEGIN
  IF position('commerce_cart_quota_request_scope_v1' IN definition) > 0 THEN
    RAISE EXCEPTION 'Commerce cart quota request scope is already installed';
  END IF;
  IF position('request_role = ''cache_invalidation_worker''' IN definition) = 0
    OR position('/rpc/claim_cache_invalidations' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected cache invalidation scope before restoring cart quota scope';
  END IF;
  IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'Unexpected shared worker request-scope definition';
  END IF;

  EXECUTE replace(definition, anchor, insertion || anchor);
END;
$quota_scope$;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
