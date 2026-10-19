\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
END;
$$;
CREATE FUNCTION pg_temp.expect_denied(command text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'Expected authorization denial';
END;
$$;

CREATE FUNCTION pg_temp.expect_state(command text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected_state THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected SQLSTATE %', expected_state;
END;
$$;

SELECT pg_temp.assert_true(session_user = 'supabase_admin' AND current_user = 'supabase_admin'
  AND inet_client_addr() IS NULL AND current_database() = 'postgres'
  AND (SELECT system_identifier::text FROM pg_control_system()) = '7685292944002592802', 'exact isolated admin socket');
\set merchant '10000000-0000-4000-8000-000000000001'
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM public.customers
  WHERE id = :'customer_a' AND user_id = :'actor_a' AND merchant_id = :'merchant'), 'parent customer fixture');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM auth.users WHERE id = :'actor_b')
  AND :'actor_a' <> :'actor_b', 'distinct parent Auth fixtures');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM savings_draft_private.hosted_draft_bindings
  WHERE merchant_id = :'merchant'), 'no preexisting hosted bindings');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated', 'savings_draft_private.hosted_draft_bindings', 'INSERT')
  AND NOT has_table_privilege('anon', 'savings_draft_private.hosted_draft_bindings', 'SELECT')
  AND NOT has_table_privilege('service_role', 'savings_draft_private.hosted_draft_bindings', 'UPDATE'), 'no client binding privileges');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated',
  'savings_draft_private.hosted_draft_visible(uuid,uuid)', 'EXECUTE'), 'runtime helper remains private');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM savings_draft_private.settings
  WHERE merchant_id = :'merchant' AND NOT enabled), 'parent disabled draft policy fixture');
SELECT count(*) AS goals_before FROM public.customer_savings_goals \gset
SELECT count(*) AS bindings_before FROM savings_draft_private.canonical_bindings \gset
UPDATE savings_draft_private.settings SET environment = 'hosted_draft', enabled = true
  WHERE merchant_id = :'merchant';
SELECT set_config('request.jwt.claim.sub', :'actor_a', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_denied(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant', 'list', '{}'));
SELECT pg_temp.assert_true(NOT savings_draft_private.visible(:'customer_a', :'merchant'), 'missing binding denies visibility');
RESET ROLE;

INSERT INTO savings_draft_private.hosted_draft_bindings
  (merchant_id, actor_id, customer_id, system_identifier, database_name)
  VALUES (:'merchant', :'actor_a', :'customer_a', '7685292944002592802', 'postgres');
SELECT pg_temp.assert_true(NOT (SELECT enabled FROM savings_draft_private.hosted_draft_bindings
  WHERE merchant_id = :'merchant' AND actor_id = :'actor_a'), 'binding defaults disabled');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_denied(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant', 'list', '{}'));
SELECT pg_temp.expect_denied('UPDATE savings_draft_private.hosted_draft_bindings SET enabled = true');
RESET ROLE;
SELECT pg_temp.expect_denied(format('UPDATE savings_draft_private.hosted_draft_bindings SET system_identifier = %L', 'wrong-runtime'));
SELECT pg_temp.expect_denied(format('UPDATE savings_draft_private.hosted_draft_bindings SET database_name = %L', 'wrong_database'));
SELECT pg_temp.expect_denied(format('UPDATE savings_draft_private.hosted_draft_bindings SET merchant_id = %L', '10000000-0000-4000-8000-000000000002'));
SELECT pg_temp.expect_denied(format('UPDATE savings_draft_private.hosted_draft_bindings SET actor_id = %L', :'actor_b'));
UPDATE savings_draft_private.hosted_draft_bindings SET enabled = true WHERE merchant_id = :'merchant';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(savings_draft_private.visible(:'customer_a', :'merchant'), 'bound authenticated customer visible');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant', 'list', '{}')->'drafts' IS NOT NULL, 'bound command authorized');
\set product '10000000-0000-4000-8000-000000000003'
\set variant_a '10000000-0000-4000-8000-000000000004'
\set variant_b '10000000-0000-4000-8000-000000000005'
\set request_a 'd5150000-0000-4000-8000-000000000001'
\set request_b 'd5150000-0000-4000-8000-000000000002'
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant', 'list',
  jsonb_build_object('requestId', :'request_a'))->'drafts' = '[]'::jsonb, 'first request has no existing draft');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant', 'list',
  jsonb_build_object('requestId', :'request_b'))->'drafts' = '[]'::jsonb, 'second request has no existing draft');
SELECT jsonb_build_object('productId', :'product', 'variantId', :'variant_a', 'requestId', :'request_a') AS create_input \gset
SELECT pg_temp.expect_state(format('SELECT public.customer_savings_draft_command(%L,%L,%L)',
  :'merchant', 'create', :'create_input'::jsonb || '{"variantId":null}'), '22023');
SELECT pg_temp.expect_state(format('SELECT public.customer_savings_draft_command(%L,%L,%L)',
  :'merchant', 'create', :'create_input'::jsonb || '{"price":1}'), '22023');
SELECT public.customer_savings_draft_command(:'merchant', 'create', :'create_input') AS original \gset
SELECT pg_temp.assert_true(:'original'::jsonb #>> '{draft,productId}' = :'product'
  AND :'original'::jsonb #>> '{draft,variantId}' = :'variant_a'
  AND :'original'::jsonb #>> '{draft,requestId}' = :'request_a'
  AND :'original'::jsonb #> '{draft,acceptedAt}' = 'null'::jsonb
  AND length(:'original'::jsonb #>> '{draft,draftId}') = 36
  AND length(:'original'::jsonb #>> '{draft,revisionId}') = 36, 'hosted create returns unaccepted exact variant draft');
SELECT pg_temp.assert_true(jsonb_array_length(:'original'::jsonb #> '{draft,catalogue,variants}') = 1
  AND :'original'::jsonb #>> '{draft,catalogue,variants,0,id}' = :'variant_a'
  AND (:'original'::jsonb #>> '{draft,catalogue,variants,0,price_override}')::numeric = 250000,
  'hosted catalogue snapshots only selected 256GB variant and server price');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant', 'create', :'create_input') = :'original'::jsonb,
  'identical hosted create replays draft and revision');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant', 'list',
  jsonb_build_object('requestId', :'request_a'))->'drafts' = jsonb_build_array(:'original'::jsonb->'draft'),
  'hosted reload returns exactly one original draft');
SELECT pg_temp.expect_state(format('SELECT public.customer_savings_draft_command(%L,%L,%L)',
  :'merchant', 'create', :'create_input'::jsonb || jsonb_build_object('variantId', :'variant_b')), '23505');
SELECT public.customer_savings_draft_command(:'merchant', 'create', jsonb_build_object(
  'productId', :'product', 'variantId', :'variant_b', 'requestId', :'request_b')) AS second_variant \gset
SELECT pg_temp.assert_true(:'second_variant'::jsonb #>> '{draft,variantId}' = :'variant_b'
  AND :'second_variant'::jsonb #>> '{draft,draftId}' <> :'original'::jsonb #>> '{draft,draftId}'
  AND jsonb_array_length(:'second_variant'::jsonb #> '{draft,catalogue,variants}') = 1
  AND :'second_variant'::jsonb #>> '{draft,catalogue,variants,0,id}' = :'variant_b'
  AND (:'second_variant'::jsonb #>> '{draft,catalogue,variants,0,price_override}')::numeric = 320000,
  'distinct request snapshots exact 512GB variant without aliasing first draft');
SELECT jsonb_build_object('draftId', :'original'::jsonb #>> '{draft,draftId}') AS policy_input \gset
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant', 'policy', :'policy_input') = :'original'::jsonb,
  'policy read preserves unaccepted draft');
SELECT jsonb_build_object('draftId', :'original'::jsonb #>> '{draft,draftId}',
  'revisionId', :'original'::jsonb #>> '{draft,revisionId}',
  'termsVersion', :'original'::jsonb #>> '{draft,terms,version}',
  'termsHash', :'original'::jsonb #>> '{draft,terms,hash}', 'accepted', true) AS accept_input \gset
SELECT pg_temp.expect_state(format('SELECT public.customer_savings_draft_command(%L,%L,%L)',
  :'merchant', 'accept', :'accept_input'::jsonb || '{"accepted":false}'), '22023');
SELECT pg_temp.expect_state(format('SELECT public.customer_savings_draft_command(%L,%L,%L)',
  :'merchant', 'accept', :'accept_input'::jsonb || jsonb_build_object('revisionId', :'request_b')), '23505');
SELECT pg_temp.expect_state(format('SELECT public.customer_savings_draft_command(%L,%L,%L)',
  :'merchant', 'accept', :'accept_input'::jsonb || '{"termsHash":"wrong-hash"}'), '23505');
SELECT public.customer_savings_draft_command(:'merchant', 'accept', :'accept_input') AS accepted \gset
SELECT pg_temp.assert_true(jsonb_typeof(:'accepted'::jsonb #> '{draft,acceptedAt}') = 'string'
  AND (:'accepted'::jsonb #>> '{draft,acceptedAt}')::timestamptz >= (:'original'::jsonb #>> '{draft,createdAt}')::timestamptz
  AND ((:'accepted'::jsonb->'draft') - 'acceptedAt') = ((:'original'::jsonb->'draft') - 'acceptedAt'),
  'accept changes only acceptance timestamp');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant', 'accept', :'accept_input') = :'accepted'::jsonb,
  'hosted accept replay preserves timestamp');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant', 'create', :'create_input') = :'accepted'::jsonb,
  'hosted create replay after accept preserves accepted state');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant', 'list',
  jsonb_build_object('requestId', :'request_a'))->'drafts' = jsonb_build_array(:'accepted'::jsonb->'draft'),
  'hosted reload retains exactly one accepted draft');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant', 'list',
  jsonb_build_object('requestId', :'request_b'))->'drafts' = jsonb_build_array(:'second_variant'::jsonb->'draft'),
  'accepting first variant does not alter second variant draft');
SELECT pg_temp.expect_state(format('SELECT public.customer_savings_draft_command(%L,%L,%L)',
  :'merchant', 'activate', :'policy_input'), '22023');
SELECT pg_temp.expect_denied(format('INSERT INTO piggyvest_goal_policy.lifecycle_activations(goal_id) VALUES(%L)',
  :'original'::jsonb #>> '{draft,draftId}'));
RESET ROLE;
CREATE FUNCTION pg_temp.expect_canonical_guard(p_draft uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.customer_savings_goals(merchant_id, customer_id, product_id, variant_id,
      title, target_amount, status, source_mode, goal_kind, canonical_draft_id, canonical_draft_revision_id, canonical_actor_id)
      SELECT draft.merchant_id, draft.customer_id, draft.product_id, draft.variant_id,
        draft.catalogue->>'name', (draft.catalogue #>> '{variants,0,price_override}')::numeric,
        'paused', 'manual', 'canonical_local', draft.id, draft.revision_id, draft.actor_id
      FROM public.customer_savings_drafts draft WHERE draft.id = p_draft;
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM = 'Canonical creation local boundary denied' THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected existing canonical local boundary to deny hosted draft promotion';
END;
$$;
SELECT pg_temp.expect_canonical_guard((:'original'::jsonb #>> '{draft,draftId}')::uuid);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_denied(format('SELECT public.customer_savings_draft_command(%L,%L,%L)',
  '10000000-0000-4000-8000-000000000002', 'list', '{}'));
SELECT set_config('request.jwt.claim.sub', :'actor_b', true);
SELECT pg_temp.assert_true(NOT savings_draft_private.visible(:'customer_a', :'merchant'), 'wrong account invisible');
SELECT pg_temp.expect_denied(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant', 'list', '{}'));
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.assert_true(NOT savings_draft_private.visible(:'customer_a', :'merchant'), 'unauthenticated invisible');
SELECT pg_temp.expect_denied(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant', 'list', '{}'));
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', :'actor_a', true);
UPDATE savings_draft_private.settings SET enabled = false WHERE merchant_id = :'merchant';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_denied(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant', 'list', '{}'));
RESET ROLE;
UPDATE savings_draft_private.settings SET enabled = true WHERE merchant_id = :'merchant';
ALTER TABLE savings_draft_private.hosted_draft_bindings DISABLE TRIGGER hosted_draft_binding_guard;
UPDATE savings_draft_private.hosted_draft_bindings SET system_identifier = 'stale-restored-runtime'
  WHERE merchant_id = :'merchant';
ALTER TABLE savings_draft_private.hosted_draft_bindings ENABLE TRIGGER hosted_draft_binding_guard;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(NOT savings_draft_private.visible(:'customer_a', :'merchant'), 'stale runtime binding invisible');
SELECT pg_temp.expect_denied(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant', 'list', '{}'));
RESET ROLE;
UPDATE savings_draft_private.settings SET environment = 'local_test' WHERE merchant_id = :'merchant';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(savings_draft_private.visible(:'customer_a', :'merchant'), 'local_test remains independent of hosted binding');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.customer_savings_goals) = :'goals_before'::bigint, 'no canonical or legacy goals created');
SELECT pg_temp.assert_true((SELECT count(*) FROM savings_draft_private.canonical_bindings) = :'bindings_before'::bigint, 'no canonical bindings created');
ROLLBACK;
