\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.reject_binding(command text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE command;
  EXCEPTION WHEN check_violation THEN RETURN;
  END;
  RAISE EXCEPTION 'Expected binding review rejection';
END $$;
SELECT count(*) AS before_bindings FROM savings_draft_private.canonical_bindings \gset
SET SESSION AUTHORIZATION piggyvest_staging_policy_writer;
SELECT pg_temp.reject_binding(format('SELECT savings_draft_private.bind_canonical(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :'integration', :'merchant', :'customer', :'expired_goal', :'business', :'actor', :'draft', :'draft_revision', :'expired_revision'));
SELECT pg_temp.reject_binding(format('SELECT savings_draft_private.bind_canonical(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :'integration', :'merchant', :'customer', :'wrong_price_goal', :'business', :'actor', :'draft', :'draft_revision', :'wrong_price_revision'));
SELECT pg_temp.reject_binding(format('SELECT savings_draft_private.bind_canonical(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :'integration', :'merchant', :'customer', :'wrong_device_goal', :'business', :'actor', :'draft', :'draft_revision', :'wrong_device_revision'));
SELECT pg_temp.reject_binding(format('SELECT savings_draft_private.bind_canonical(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :'integration', :'merchant', :'customer', :'exposed_goal', :'business', :'actor', :'draft', :'draft_revision', :'exposed_revision'));
RESET SESSION AUTHORIZATION;
SELECT count(*) = :before_bindings AS unchanged FROM savings_draft_private.canonical_bindings \gset
\if :unchanged
\echo 'PASS expired quote, wrong price/device and provider-exposed fixture rejection without binding'
\else
\quit 1
\endif
ROLLBACK;
