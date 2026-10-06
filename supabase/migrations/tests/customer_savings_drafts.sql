\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
END;
$$;
CREATE FUNCTION pg_temp.expect_error(command text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
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

\set merchant_a 'd1000000-0000-4000-8000-000000000001'
\set merchant_b 'd1000000-0000-4000-8000-000000000002'
\set customer_a 'd2000000-0000-4000-8000-000000000001'
\set customer_b 'd2000000-0000-4000-8000-000000000002'
\set product_a 'd3000000-0000-4000-8000-000000000001'
\set product_b 'd3000000-0000-4000-8000-000000000002'
\set variant_a 'd4000000-0000-4000-8000-000000000001'
\set request_a 'd5000000-0000-4000-8000-000000000001'

SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM auth.users WHERE id = :'actor_a'), 'real local actor A exists');
SELECT pg_temp.assert_true(EXISTS(SELECT 1 FROM auth.users WHERE id = :'actor_b'), 'real local actor B exists');
SELECT set_config('request.jwt.claim.sub', :'actor_a', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO public.merchants(id, email, business_name, slug, is_published)
  VALUES (:'merchant_a', 'draft-regression-a@example.invalid', 'Draft regression A', 'draft-regression-a', true),
         (:'merchant_b', 'draft-regression-b@example.invalid', 'Draft regression B', 'draft-regression-b', true);
INSERT INTO public.staff_members(merchant_id, user_id, email, name, status)
  VALUES (:'merchant_a', :'actor_a', 'draft-setup-a@example.invalid', 'Draft fixture setup', 'active'),
         (:'merchant_b', :'actor_a', 'draft-setup-b@example.invalid', 'Draft fixture setup', 'active');
INSERT INTO public.customers(id, merchant_id, user_id, email)
  VALUES (:'customer_a', :'merchant_a', :'actor_a', 'draft-customer-a@example.invalid'),
         (:'customer_b', :'merchant_a', :'actor_b', 'draft-customer-b@example.invalid');
INSERT INTO public.products(id, merchant_id, name, slug, price, condition, status, has_variants, images)
  VALUES (:'product_a', :'merchant_a', 'Draft regression device', 'draft-regression-device', 100, 'new', 'active', true, '[]'),
         (:'product_b', :'merchant_b', 'Other merchant device', 'other-merchant-device', 500, 'new', 'active', false, '[]');
INSERT INTO public.product_variants(id, product_id, merchant_id, attributes, condition, price_override)
  VALUES (:'variant_a', :'product_a', :'merchant_a', '{"storage":"256GB"}', 'used', 125);
DELETE FROM public.staff_members WHERE merchant_id IN (:'merchant_a', :'merchant_b') AND user_id = :'actor_a';

SELECT encode(extensions.digest(convert_to('Local regression disclosure only. No financial terms are approved by this test.', 'UTF8'), 'sha256'), 'hex') AS terms_hash \gset
INSERT INTO piggyvest_goal_policy.terms(version, sha256, enabled) VALUES ('local-draft-regression-v1', :'terms_hash', true);
INSERT INTO savings_draft_private.documents(version, sha256, content)
  VALUES ('local-draft-regression-v1', :'terms_hash', 'Local regression disclosure only. No financial terms are approved by this test.');
INSERT INTO savings_draft_private.settings(merchant_id, environment, terms_version, terms_hash)
  VALUES (:'merchant_a', 'local_test', 'local-draft-regression-v1', :'terms_hash');
SELECT pg_temp.assert_true(NOT (SELECT enabled FROM savings_draft_private.settings WHERE merchant_id = :'merchant_a'), 'setting defaults disabled');
SELECT count(*) AS goals_before FROM public.customer_savings_goals \gset
SELECT count(*) AS contributions_before FROM public.customer_savings_contributions \gset
SELECT count(*) AS ledger_before FROM piggyvest_savings_ledger.operations \gset
SELECT count(*) AS wallet_transactions_before FROM public.customer_wallet_transactions \gset

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'actor_a', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'list', '{}'), '42501');
SELECT pg_temp.expect_error('SELECT merchant_id FROM savings_draft_private.settings', '42501');
SELECT pg_temp.expect_error('UPDATE savings_draft_private.settings SET enabled = true', '42501');
SELECT pg_temp.expect_error('SELECT content FROM savings_draft_private.documents', '42501');
RESET ROLE;
UPDATE savings_draft_private.settings SET enabled = true WHERE merchant_id = :'merchant_a';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'create', '{}'), '42501');
SELECT set_config('request.jwt.claim.sub', :'actor_a', true);
SELECT jsonb_build_object('productId', :'product_a', 'variantId', :'variant_a', 'requestId', :'request_a') AS create_input \gset
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_b', 'create', :'create_input'), '42501');
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'create', :'create_input'::jsonb || '{"price":1}'), '22023');
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'create', :'create_input'::jsonb || '{"variantId":null}'), '22023');
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'create', :'create_input'::jsonb || jsonb_build_object('productId', :'product_b')), 'P0002');
SELECT public.customer_savings_draft_command(:'merchant_a', 'create', :'create_input') AS original \gset
SELECT pg_temp.assert_true(:'original'::jsonb #>> '{draft,acceptedAt}' IS NULL, 'pre-consent draft has no acceptance');
SELECT pg_temp.assert_true((:'original'::jsonb #>> '{draft,catalogue,variants,0,price_override}')::numeric = 125, 'exact variant price from database');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant_a', 'create', :'create_input') = :'original'::jsonb, 'durable identical replay');
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'create', :'create_input'::jsonb || '{"variantId":null}'), '23505');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.customer_savings_drafts WHERE merchant_id = :'merchant_a') = 1, 'single persisted draft');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant_a', 'list', jsonb_build_object('requestId', :'request_a'))->'drafts'->0 = :'original'::jsonb->'draft', 'reload by durable request');
SELECT pg_temp.expect_error('UPDATE public.customer_savings_drafts SET accepted_at = now()', '42501');
SELECT pg_temp.expect_error('DELETE FROM public.customer_savings_drafts', '42501');
SELECT pg_temp.expect_error('INSERT INTO public.customer_savings_drafts DEFAULT VALUES', '42501');

SELECT set_config('request.jwt.claim.sub', :'actor_b', true);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.customer_savings_drafts WHERE merchant_id = :'merchant_a') = 0, 'RLS denies other customer');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant_a', 'list', '{}')->'drafts' = '[]'::jsonb, 'RPC list denies other customer');
SELECT jsonb_build_object('draftId', :'original'::jsonb #>> '{draft,draftId}') AS policy_input \gset
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'policy', :'policy_input'), 'P0002');
SELECT jsonb_build_object('draftId', :'original'::jsonb #>> '{draft,draftId}', 'revisionId', :'original'::jsonb #>> '{draft,revisionId}',
  'termsVersion', 'local-draft-regression-v1', 'termsHash', :'terms_hash', 'accepted', true) AS accept_input \gset
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'accept', :'accept_input'), 'P0002');
SELECT set_config('request.jwt.claim.sub', :'actor_a', true);
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant_a', 'policy', :'policy_input') = :'original'::jsonb, 'read-only disclosure is stable');
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'accept', :'accept_input'::jsonb || '{"accepted":false}'), '22023');
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'accept', :'accept_input'::jsonb || jsonb_build_object('revisionId', :'request_a')), '23505');
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'accept', :'accept_input'::jsonb || jsonb_build_object('termsHash', repeat('0',64))), '23505');

RESET ROLE;
UPDATE piggyvest_goal_policy.terms SET enabled = false WHERE version = 'local-draft-regression-v1';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'accept', :'accept_input'), '23514');
RESET ROLE;
UPDATE piggyvest_goal_policy.terms SET enabled = true WHERE version = 'local-draft-regression-v1';
UPDATE public.product_variants SET price_override = 150 WHERE id = :'variant_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant_a', 'create', :'create_input') = :'original'::jsonb, 'lost-response replay keeps original snapshot after catalogue change');
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'accept', :'accept_input'), '23514');
RESET ROLE;
UPDATE public.product_variants SET price_override = 125, attributes = '{"storage":"128GB"}' WHERE id = :'variant_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'accept', :'accept_input'), '23514');
RESET ROLE;
UPDATE public.product_variants SET attributes = '{"storage":"256GB"}' WHERE id = :'variant_a';
SET LOCAL ROLE authenticated;
SELECT public.customer_savings_draft_command(:'merchant_a', 'accept', :'accept_input') AS accepted \gset
SELECT pg_temp.assert_true(:'accepted'::jsonb #>> '{draft,acceptedAt}' IS NOT NULL, 'explicit consent persisted');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant_a', 'accept', :'accept_input') = :'accepted'::jsonb, 'acceptance replay preserves exact receipt');
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant_a', 'policy', :'policy_input') = :'accepted'::jsonb, 'accepted receipt reload');
RESET ROLE;
UPDATE public.product_variants SET price_override = 150 WHERE id = :'variant_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.customer_savings_draft_command(:'merchant_a', 'accept', :'accept_input') = :'accepted'::jsonb, 'accepted receipt replay survives later catalogue change');
RESET ROLE;
SELECT pg_temp.expect_error(format('UPDATE savings_draft_private.documents SET content=%L', 'tampered document'), '23514');
SELECT pg_temp.expect_error('UPDATE public.customer_savings_drafts SET accepted_at = now()', '23514');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.customer_savings_goals) = :'goals_before'::bigint, 'no legacy goal promotion');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.customer_savings_contributions) = :'contributions_before'::bigint, 'no contribution');
SELECT pg_temp.assert_true((SELECT count(*) FROM piggyvest_savings_ledger.operations) = :'ledger_before'::bigint, 'no canonical ledger operation');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.customer_wallet_transactions) = :'wallet_transactions_before'::bigint, 'no wallet movement');
UPDATE savings_draft_private.settings SET enabled = false WHERE merchant_id = :'merchant_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.customer_savings_drafts WHERE merchant_id = :'merchant_a') = 0, 'disabled feature hides drafts through RLS');
SELECT pg_temp.expect_error(format('SELECT public.customer_savings_draft_command(%L,%L,%L)', :'merchant_a', 'policy', :'policy_input'), '42501');
RESET ROLE;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.customer_savings_draft_command(uuid,text,jsonb)', 'EXECUTE'), 'anonymous RPC revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role', 'public.customer_savings_draft_command(uuid,text,jsonb)', 'EXECUTE'), 'service-role RPC revoked');
ROLLBACK;
