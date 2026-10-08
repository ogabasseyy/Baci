CREATE FUNCTION pg_temp.reviewed_state() RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog AS $state$
DECLARE entry record; expression text; predicate text; rows_hash text; result jsonb:='{}';
BEGIN
  FOR entry IN SELECT namespace.nspname,relation.relname FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE relation.relkind IN ('r','p') AND namespace.nspname<>'information_schema'
      AND namespace.nspname !~ '^pg_' ORDER BY namespace.nspname,relation.relname LOOP
    expression:='to_jsonb(source)'; predicate:='true';
    IF entry.nspname='prefunded_card' AND entry.relname='checkout_intents' THEN
      expression:='CASE WHEN source.id=''ff561046-58e7-428d-9163-f6e60b0dab65''::uuid
        THEN to_jsonb(source)-ARRAY[''phase'',''verified_collection''] ELSE to_jsonb(source) END';
    ELSIF entry.nspname='prefunded_card' AND entry.relname='operations' THEN
      expression:='CASE WHEN source.id=''ff561046-58e7-428d-9163-f6e60b0dab65''::uuid
        THEN to_jsonb(source)-ARRAY[''collection_status'',''collection_provider_transaction_id''] ELSE to_jsonb(source) END';
    ELSIF entry.nspname='public' AND entry.relname='customer_saved_payment_methods' THEN
      predicate:='source.id<>(SELECT prepared_saved_method_id FROM prefunded_card.checkout_intents
        WHERE id=''ff561046-58e7-428d-9163-f6e60b0dab65''::uuid)';
    ELSIF entry.nspname='prefunded_card' AND entry.relname='authorization_bindings' THEN
      predicate:='source.transaction_id<>''ff561046-58e7-428d-9163-f6e60b0dab65''::uuid';
    END IF;
    EXECUTE format('SELECT encode(sha256(convert_to(coalesce(jsonb_agg(payload ORDER BY payload::text),
      ''[]''::jsonb)::text,''UTF8'')),''hex'') FROM (SELECT %s payload FROM %I.%I source WHERE %s) normalized',
      expression,entry.nspname,entry.relname,predicate) INTO rows_hash;
    result:=result||jsonb_build_object(entry.nspname||'.'||entry.relname,rows_hash);
  END LOOP;
  RETURN encode(sha256(convert_to(result::text,'UTF8')),'hex');
END $state$;

CREATE FUNCTION pg_temp.reviewed_metadata() RETURNS text
LANGUAGE sql SET search_path=pg_catalog AS $metadata$
  WITH namespaces AS (SELECT oid FROM pg_namespace WHERE nspname<>'information_schema' AND nspname !~ '^pg_'),
    relations AS (SELECT relation.oid FROM pg_class relation WHERE relnamespace IN (SELECT oid FROM namespaces))
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'namespaces',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_namespace entry WHERE oid IN (SELECT oid FROM namespaces)),
    'relations',(SELECT jsonb_agg(jsonb_build_object('oid',oid,'name',relname,'namespace',relnamespace,'owner',relowner,
      'kind',relkind,'acl',relacl,'rls',relrowsecurity,'forceRls',relforcerowsecurity,'persistence',relpersistence,
      'options',reloptions) ORDER BY oid) FROM pg_class WHERE oid IN (SELECT oid FROM relations)),
    'routines',(SELECT jsonb_agg(jsonb_build_object('catalog',to_jsonb(entry),'definition',pg_get_functiondef(oid)) ORDER BY oid)
      FROM pg_proc entry WHERE pronamespace IN (SELECT oid FROM namespaces) AND prokind='f'),
    'triggers',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_trigger entry WHERE tgrelid IN (SELECT oid FROM relations)),
    'policies',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_policy entry WHERE polrelid IN (SELECT oid FROM relations)),
    'constraints',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_constraint entry WHERE connamespace IN (SELECT oid FROM namespaces)),
    'attributes',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY attrelid,attnum) FROM pg_attribute entry WHERE attrelid IN (SELECT oid FROM relations)),
    'defaults',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_attrdef entry WHERE adrelid IN (SELECT oid FROM relations)),
    'indexes',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY indexrelid) FROM pg_index entry WHERE indrelid IN (SELECT oid FROM relations)),
    'roles',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_authid entry),
    'memberships',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY roleid,member) FROM pg_auth_members entry),
    'defaultAcls',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_default_acl entry),
    'databases',(SELECT jsonb_agg(to_jsonb(entry) ORDER BY oid) FROM pg_database entry)
  )::text,'UTF8')),'hex');
$metadata$;
REVOKE ALL ON FUNCTION pg_temp.reviewed_state(),pg_temp.reviewed_metadata() FROM PUBLIC;
