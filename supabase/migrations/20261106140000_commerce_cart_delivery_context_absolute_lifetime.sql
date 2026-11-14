-- Keep delivery-context reads within the cart, checkout-session, and grant
-- absolute lifetimes, even when persisted expires_at values were extended.
DO $fix$
DECLARE
  definition text;
  session_old text := $old$    AND s.expires_at > pg_catalog.clock_timestamp();$old$;
  session_new text := $new$    AND s.expires_at > pg_catalog.clock_timestamp()
    AND s.created_at + interval '7 days' > pg_catalog.clock_timestamp();$new$;
  cart_old text := $old$    OR cart.expires_at <= pg_catalog.clock_timestamp() THEN$old$;
  cart_new text := $new$    OR cart.expires_at <= pg_catalog.clock_timestamp()
    OR cart.created_at + interval '7 days' <= pg_catalog.clock_timestamp() THEN$new$;
  grant_old text := $old$    AND g.expires_at > pg_catalog.clock_timestamp()$old$;
  grant_new text := $new$    AND g.expires_at > pg_catalog.clock_timestamp()
    AND g.created_at + interval '7 days' > pg_catalog.clock_timestamp()$new$;
  session_old_count integer;
  session_new_count integer;
  cart_old_count integer;
  cart_new_count integer;
  grant_old_count integer;
  grant_new_count integer;
BEGIN
  definition := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_delivery_context(uuid,integer,integer)'::regprocedure
  );

  session_new_count := (length(definition) - length(replace(definition, session_new, ''))) / length(session_new);
  session_old_count := (length(replace(definition, session_new, ''))
    - length(replace(replace(definition, session_new, ''), session_old, ''))) / length(session_old);
  cart_new_count := (length(definition) - length(replace(definition, cart_new, ''))) / length(cart_new);
  cart_old_count := (length(replace(definition, cart_new, ''))
    - length(replace(replace(definition, cart_new, ''), cart_old, ''))) / length(cart_old);
  grant_new_count := (length(definition) - length(replace(definition, grant_new, ''))) / length(grant_new);
  grant_old_count := (length(replace(definition, grant_new, ''))
    - length(replace(replace(definition, grant_new, ''), grant_old, ''))) / length(grant_old);

  -- Reapplication is a no-op only when every expected replacement is
  -- present and every original fragment is absent. Mixed/partial edits fail.
  IF session_old_count = 0 AND session_new_count = 2
    AND cart_old_count = 0 AND cart_new_count = 1
    AND grant_old_count = 0 AND grant_new_count = 1 THEN
    RETURN;
  END IF;
  IF session_old_count <> 2 OR session_new_count <> 0
    OR cart_old_count <> 1 OR cart_new_count <> 0
    OR grant_old_count <> 1 OR grant_new_count <> 0 THEN
    RAISE EXCEPTION 'delivery context lifetime migration found partial/unknown fragments (session old/new %,/%; cart old/new %,/%; grant old/new %,/%)',
      session_old_count, session_new_count, cart_old_count, cart_new_count, grant_old_count, grant_new_count;
  END IF;

  definition := replace(definition, session_old, session_new);
  definition := replace(definition, cart_old, cart_new);
  definition := replace(definition, grant_old, grant_new);

  EXECUTE definition;
END;
$fix$;
