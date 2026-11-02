-- #3746: do not let request claim GUCs upgrade the caller's SQL role.
-- PostgREST assumes the verified JWT role with SET LOCAL ROLE before invoking
-- this function; SECURITY DEFINER does not change the role setting itself.
DO $repair$
DECLARE
 definition text;
 old_guard text := $old$  IF p_merchant_id IS NULL AND coalesce(
    nullif(auth.jwt()->>'role',''),
    nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('role',true),'none'),'anon'
  ) NOT IN ('authenticated','service_role') THEN$old$;
 new_guard text := $new$  IF p_merchant_id IS NULL AND coalesce(
    nullif(current_setting('role',true),'none'),'anon'
  ) NOT IN ('authenticated','service_role') THEN$new$;
BEGIN
 SELECT pg_get_functiondef('public.get_storefront_offer_resolution(uuid,uuid[])'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 THEN
  RAISE EXCEPTION 'offer caller-role guard source shape changed';
 END IF;
 EXECUTE replace(definition,old_guard,new_guard);
END;
$repair$;
