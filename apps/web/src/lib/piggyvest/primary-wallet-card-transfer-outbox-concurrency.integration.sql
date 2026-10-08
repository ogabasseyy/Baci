\set ON_ERROR_STOP on
SET SESSION AUTHORIZATION baci_primary_card_transfer;
BEGIN;
SELECT piggyvest_primary_card.claim_transfer((scope->>'integrationId')::uuid,'staging',operation_id)->>'outcome' FROM public.custody_fixture WHERE label='fifth@example.test';
SELECT pg_sleep(0.25);
COMMIT;
