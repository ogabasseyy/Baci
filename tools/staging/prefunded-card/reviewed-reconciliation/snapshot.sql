SELECT jsonb_build_object(
  'intentSha256',encode(sha256(convert_to(to_jsonb(intent)::text,'UTF8')),'hex'),
  'operationSha256',encode(sha256(convert_to(to_jsonb(operation)::text,'UTF8')),'hex'),
  'protectedRowsSha256',pg_temp.reviewed_state(),
  'permanentMetadataSha256',pg_temp.reviewed_metadata(),
  'routine',(SELECT jsonb_build_object('oid',entry.oid::bigint,'ownerOid',proowner::bigint,
    'owner',pg_get_userbyid(proowner),'acl',proacl,'securityDefiner',prosecdef,
    'configuration',proconfig,'language',language.lanname)
    FROM pg_proc entry JOIN pg_language language ON language.oid=entry.prolang
    WHERE entry.oid='prefunded_card.checkout_promote_collection(jsonb,jsonb,jsonb)'::regprocedure)
) FROM prefunded_card.checkout_intents intent
  JOIN prefunded_card.operations operation ON operation.id=intent.operation_id
  WHERE intent.id='ff561046-58e7-428d-9163-f6e60b0dab65';
