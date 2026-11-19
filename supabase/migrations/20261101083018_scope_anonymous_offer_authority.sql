-- #3746: all anonymous application callers now supply a merchant scope.
-- Preserve the signature, grants and existing allocation authority verbatim.
DO $repair$
DECLARE definition text;
 anchor text := $anchor$BEGIN
  -- Tiered batch caps:$anchor$;
 replacement text := $guard$BEGIN
  IF p_merchant_id IS NULL AND coalesce(
    nullif(auth.jwt()->>'role',''),
    nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('role',true),'none'),'anon'
  ) NOT IN ('authenticated','service_role') THEN
    RAISE EXCEPTION 'merchant_scope_required' USING ERRCODE='42501';
  END IF;
  -- Tiered batch caps:$guard$;
BEGIN
 SELECT pg_get_functiondef('public.get_storefront_offer_resolution(uuid,uuid[])'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'offer scope repair source shape changed'; END IF;
 EXECUTE replace(definition,anchor,replacement);
END;
$repair$;
