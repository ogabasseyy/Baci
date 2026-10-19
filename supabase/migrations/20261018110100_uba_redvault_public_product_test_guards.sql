DO $$
DECLARE
  signature text;
  definition text;
  branch text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'private.enforce_uba_redvault_private_pilot_order()',
    'private.enforce_uba_redvault_private_pilot_attempt()',
    'private.validate_redvault_commercial_terms()',
    'private.assert_uba_redvault_private_pilot_active(uuid)'
  ] LOOP
    definition:=pg_catalog.pg_get_functiondef(signature::regprocedure);
    IF pg_catalog.strpos(definition,'assert_uba_redvault_public_product_test_order')>0
      OR (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,E'BEGIN\n','')))
        /pg_catalog.length(E'BEGIN\n')<1 THEN
      RAISE EXCEPTION 'redvault_public_test_guard_source_unexpected:%',signature;
    END IF;
    IF signature='private.assert_uba_redvault_private_pilot_active(uuid)' THEN
      branch:=E'  IF EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton AND audience=''public_product_test'') THEN\n'
        || E'    PERFORM private.assert_uba_redvault_public_product_test_order(p_order_id,true);\n    RETURN;\n  END IF;\n';
    ELSIF signature='private.enforce_uba_redvault_private_pilot_attempt()' THEN
      branch:=E'  IF EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton AND audience=''public_product_test'') THEN\n'
        || E'    PERFORM private.assert_uba_redvault_public_product_test_order(NEW.order_id,true);\n'
        || E'    IF NEW.currency IS DISTINCT FROM ''NGN'' OR NOT EXISTS (SELECT 1 FROM private.uba_redvault_applications public_test_application JOIN public.orders public_test_order ON public_test_order.id=public_test_application.order_id WHERE public_test_application.id=NEW.application_id AND public_test_application.order_id=NEW.order_id AND public_test_application.merchant_id=NEW.merchant_id AND NEW.amount_kobo=pg_catalog.round(public_test_order.total*100)::bigint) THEN\n'
        || E'      RAISE EXCEPTION ''redvault_public_test_attempt_mismatch'';\n    END IF;\n    RETURN NEW;\n  END IF;\n';
    ELSE
      branch:=E'  IF EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton AND audience=''public_product_test'') THEN\n'
        || E'    PERFORM private.assert_uba_redvault_public_product_test_order(NEW.order_id,false);\n'
        || E'    IF NEW.discount_kobo IS DISTINCT FROM 500::bigint OR NEW.eligible_subtotal_kobo IS DISTINCT FROM 10000::bigint OR NEW.merchant_id IS DISTINCT FROM ''6b5cb8a4-5575-456c-b936-8cdfae30db74''::uuid THEN\n'
        || E'      RAISE EXCEPTION ''redvault_public_test_application_mismatch'';\n    END IF;\n    RETURN NEW;\n  END IF;\n';
    END IF;
    definition:=pg_catalog.substr(definition,1,pg_catalog.strpos(definition,E'BEGIN\n')-1)
      || E'BEGIN\n'||branch
      || pg_catalog.substr(definition,pg_catalog.strpos(definition,E'BEGIN\n')+pg_catalog.length(E'BEGIN\n'));
    EXECUTE definition;
  END LOOP;
END;
$$;
