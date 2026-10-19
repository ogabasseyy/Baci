-- Exercises 304's verified public wrapper around 305's final owner executor.
DO $$ DECLARE token text:=repeat('8',64); hash text; claims jsonb; ctx jsonb; r jsonb; cart uuid; old_version integer; BEGIN
 UPDATE public.merchants SET payout_currency='invalid-value',country='US' WHERE id='11111111-1111-4111-8111-111111111111';
 INSERT INTO public.mcp_guest_carts(token,items,expires_at,version) VALUES(token,'[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":2}]',now()+interval '7 days',9);
 hash:=encode(sha256(token::bytea),'hex');
 claims:=jsonb_build_object('role','commerce_cart_shopper','exp',9999999999,'cart_scope','bootstrap','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_principal_id','final-bridge-owner','cart_legacy_provider','mcp','cart_legacy_hash',hash);
 PERFORM set_config('request.jwt.claims',claims::text,true);
 ctx:=public.commerce_cart_legacy_owner_context('mcp',hash);
 r:=public.commerce_cart_migrate_legacy('mcp',hash,'final-bridge-import',ctx->'lines',ctx->>'legacyVersion',ctx->>'currency');
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->'state'->>'currency' IS DISTINCT FROM 'USD' THEN RAISE EXCEPTION 'final bridge/canonical currency composition failed %',r; END IF;
 cart:=(r->'state'->>'cartId')::uuid; old_version:=(r->'state'->>'version')::integer;
 IF cart IS NULL OR old_version IS NULL THEN RAISE EXCEPTION 'final bridge omitted cart identity/version %',r; END IF;
 IF (SELECT receipt->>'bridge_owner_principal' FROM public.commerce_cart_legacy_refs WHERE cart_id=cart) IS DISTINCT FROM 'final-bridge-owner' THEN RAISE EXCEPTION 'final executor bypassed owner wrapper receipt'; END IF;
 BEGIN UPDATE public.mcp_guest_carts SET version=10 WHERE token_hash=hash; RAISE EXCEPTION 'test expected migrated cart is read-only'; EXCEPTION WHEN raise_exception THEN IF SQLERRM IS DISTINCT FROM 'migrated cart is read-only' THEN RAISE; END IF; END;
 r:=public.commerce_cart_migrate_legacy('mcp',hash,'final-bridge-import',ctx->'lines',ctx->>'legacyVersion',ctx->>'currency');
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'replayed' IS DISTINCT FROM 'true' OR r->'state'->>'cartId' IS DISTINCT FROM cart::text OR (r->'state'->>'version')::integer IS DISTINCT FROM old_version THEN RAISE EXCEPTION 'final bridge replay drift %',r; END IF;
 PERFORM set_config('request.jwt.claims',(claims||jsonb_build_object('cart_principal_id','foreign-final-bridge-owner'))::text,true);
 r:=public.commerce_cart_migrate_legacy('mcp',hash,'foreign-final-import',ctx->'lines',ctx->>'legacyVersion',ctx->>'currency');
 IF r->>'code' IS DISTINCT FROM 'unauthorized' THEN RAISE EXCEPTION 'final wrapper lost owner boundary %',r; END IF;
 IF has_function_privilege('commerce_cart_shopper','public.commerce_cart_migrate_legacy_owner_impl(text,text,text,jsonb,text,text)','EXECUTE') THEN RAISE EXCEPTION 'final executor became public through replacement'; END IF;
END $$;
