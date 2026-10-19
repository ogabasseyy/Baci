-- Restore the absolute retention bound already specified by the negotiation
-- policy migration. Keep final condition-aware writes and public grant guards.
DO $repair$
DECLARE
  definition text;
  old_renewal text := $old$expires_at = greatest(expires_at, now() + interval '7 days')$old$;
  capped_renewal text := $cap$expires_at = least(
        greatest(expires_at, now() + interval '7 days'),
        created_at + interval '7 days'
      )$cap$;
  renewal_count integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)'::regprocedure
  ) INTO STRICT definition;
  renewal_count := (length(definition)-length(replace(definition,old_renewal,'')))/length(old_renewal);
  IF renewal_count = 0 AND (length(definition)-length(replace(definition,capped_renewal,'')))/length(capped_renewal) = 2 THEN
    RETURN;
  END IF;
  IF renewal_count <> 2 THEN
    RAISE EXCEPTION 'final cart mutation renewal source does not match expected cart/grant shape';
  END IF;
  EXECUTE replace(definition,old_renewal,capped_renewal);
END $repair$;
