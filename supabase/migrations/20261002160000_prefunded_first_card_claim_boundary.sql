DO $claim_boundary$
DECLARE signature text; target oid; routine record; metadata jsonb; expected_sha text;
DECLARE anchor text; replacement text; previous_body text; next_body text; definition text;
BEGIN
  IF to_regnamespace('prefunded_card') IS NULL THEN RETURN; END IF;
  IF to_regclass('prefunded_card.checkout_intents') IS NULL
    OR current_setting('transaction_isolation')<>'read committed'
    OR current_setting('prefunded_card.claim_boundary_database',true) IS DISTINCT FROM current_database()
    OR current_setting('prefunded_card.claim_boundary_system',true) IS DISTINCT FROM
      (SELECT system_identifier::text FROM pg_control_system()) THEN
    RAISE EXCEPTION 'first-card claim boundary identity refused' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('lock_timeout','5s',true);
  PERFORM set_config('statement_timeout','30s',true);
  FOREACH signature IN ARRAY ARRAY[
    'prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid)',
    'prefunded_card.claim_reconciliation(uuid,integer)'
  ] LOOP
    target:=to_regprocedure(signature);
    SELECT p.*, language.lanname INTO routine FROM pg_proc p
      JOIN pg_language language ON language.oid=p.prolang WHERE p.oid=target;
    IF NOT FOUND OR routine.proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
      OR NOT routine.prosecdef OR routine.lanname<>'plpgsql'
      OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR NOT EXISTS (SELECT 1 FROM pg_class checkout WHERE
        checkout.oid=to_regclass('prefunded_card.checkout_intents')
        AND checkout.relowner=routine.proowner AND NOT checkout.relforcerowsecurity) THEN
      RAISE EXCEPTION 'first-card claim boundary routine refused: %',signature USING ERRCODE='42501';
    END IF;
    SELECT to_jsonb(p)-'prosrc' INTO metadata FROM pg_proc p WHERE p.oid=target;
    IF signature LIKE 'prefunded_card.claim_due(%' THEN
      expected_sha:=current_setting('prefunded_card.claim_boundary_claim_due_sha256',true);
      anchor:='AND queue.finished_at IS NULL';
      replacement:=$due$AND NOT EXISTS (
          SELECT 1 FROM prefunded_card.checkout_intents checkout_intent
          WHERE checkout_intent.operation_id=operation.id
            AND (checkout_intent.phase NOT IN ('funding_pending','completed')
              OR checkout_intent.verified_collection IS NULL))
        AND queue.finished_at IS NULL$due$;
    ELSE
      expected_sha:=current_setting('prefunded_card.claim_boundary_claim_reconciliation_sha256',true);
      anchor:='  operation:=prefunded_card.lock_scoped_operation(p_operation);';
      replacement:=$reconciliation$  operation:=prefunded_card.lock_scoped_operation(p_operation);
  IF EXISTS (SELECT 1 FROM prefunded_card.checkout_intents checkout_intent
    WHERE checkout_intent.operation_id=operation.id
      AND (checkout_intent.phase NOT IN ('funding_pending','completed')
        OR checkout_intent.verified_collection IS NULL)) THEN
    RETURN jsonb_build_object('outcome','not_verifiable');
  END IF;$reconciliation$;
    END IF;
    IF expected_sha IS NULL OR expected_sha !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'first-card claim boundary reviewed pin required: %',signature USING ERRCODE='55000';
    END IF;
    IF (length(routine.prosrc)-length(replace(routine.prosrc,anchor,'')))/length(anchor)<>1 THEN
      RAISE EXCEPTION 'first-card claim boundary anchor differs: %',signature USING ERRCODE='55000';
    END IF;
    previous_body:=replace(routine.prosrc,replacement,anchor);
    IF encode(sha256(convert_to(previous_body,'UTF8')),'hex') IS DISTINCT FROM expected_sha THEN
      RAISE EXCEPTION 'first-card claim boundary baseline differs: %',signature USING ERRCODE='55000';
    END IF;
    next_body:=replace(previous_body,anchor,replacement);
    IF routine.prosrc IS DISTINCT FROM next_body THEN
      definition:=pg_get_functiondef(target);
      IF (length(definition)-length(replace(definition,routine.prosrc,'')))/length(routine.prosrc)<>1 THEN
        RAISE EXCEPTION 'first-card claim boundary definition differs: %',signature USING ERRCODE='55000';
      END IF;
      EXECUTE replace(definition,routine.prosrc,next_body);
    END IF;
    IF to_regprocedure(signature) IS DISTINCT FROM target OR NOT EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid=target AND p.prosrc=next_body
        AND (to_jsonb(p)-'prosrc') IS NOT DISTINCT FROM metadata) THEN
      RAISE EXCEPTION 'first-card claim boundary postflight differs: %',signature USING ERRCODE='55000';
    END IF;
  END LOOP;
END $claim_boundary$;
