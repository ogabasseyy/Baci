import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Seeds the fixture schema plus v2/v3 RPC shims, then runs the legacy
// summary, reservation, and initialization-claim races.
export async function runConcurrencyLegacyRaces({
  concurrentSql,
  directory,
  migrations,
  sql,
}) {
  sql(readFileSync(resolve(directory, 'redvault-native-fixture.sql'), 'utf8'));
  const canonical = readFileSync(
    resolve(
      migrations,
      '20260828040000_bind_transaction_discount_proof_payload.sql'
    ),
    'utf8'
  );
  sql(
    canonical.slice(
      0,
      canonical.indexOf('CREATE OR REPLACE FUNCTION private.sanitize_')
    )
  );
  const proof = readFileSync(
    resolve(migrations, '20260527064322_quiz_rpc_secret_private_config.sql'),
    'utf8'
  );
  sql(
    proof.slice(
      proof.indexOf(
        'CREATE OR REPLACE FUNCTION public.quiz_route_proof_valid('
      ),
      proof.indexOf(
        'CREATE OR REPLACE FUNCTION public.quiz_rpc_server_secret_configured'
      )
    )
  );
  for (const filename of [
    '20260912090000_uba_redvault_discount_persistence.sql',
    '20260912090100_uba_redvault_snapshot_binding.sql',
    '20260912090200_uba_redvault_order_draft.sql',
    '20260912090300_uba_redvault_proof_attachment.sql',
    '20260912090400_uba_redvault_payment_completion.sql',
    '20260912090500_uba_redvault_attempt_api.sql',
  ]) {
    sql(readFileSync(resolve(migrations, filename), 'utf8'));
  }
  sql(`
    CREATE FUNCTION public.reserve_storefront_redvault_payment_attempt_v2(p_order_id uuid)
    RETURNS TABLE(attempt_id uuid,reference text,amount_kobo bigint,currency text,quote_payload_hash text,state text,bank_code text,authorization_url text,paystack_subaccount_code text,platform_fee_kobo bigint)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ DECLARE r record; BEGIN
      SELECT * INTO STRICT r FROM public.reserve_storefront_redvault_payment_attempt(p_order_id);
      RETURN QUERY SELECT r.attempt_id,r.reference,r.amount_kobo,r.currency,r.quote_payload_hash,r.state,r.bank_code,r.authorization_url,'ACCT_fixture'::text,0::bigint;
    END $$;
    CREATE FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(p_order_id uuid)
    RETURNS TABLE(attempt_id uuid,reference text,amount_kobo bigint,currency text,quote_payload_hash text,state text,bank_code text,authorization_url text,paystack_subaccount_code text,platform_fee_kobo bigint)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ DECLARE r record; BEGIN
      SELECT * INTO STRICT r FROM public.reserve_storefront_redvault_payment_attempt(p_order_id);
      RETURN QUERY SELECT r.attempt_id,r.reference,r.amount_kobo,r.currency,r.quote_payload_hash,r.state,r.bank_code,r.authorization_url,'ACCT_fixture'::text,0::bigint;
    END $$;
    CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(p_attempt_id uuid)
    RETURNS TABLE(attempt_id uuid,reference text,amount_kobo bigint,currency text,quote_payload_hash text,state text,bank_code text,authorization_url text,initialization_claimed boolean,paystack_subaccount_code text,platform_fee_kobo bigint)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ DECLARE r record; BEGIN
      SELECT * INTO STRICT r FROM public.claim_storefront_redvault_payment_attempt_initialization(p_attempt_id);
      RETURN QUERY SELECT r.attempt_id,r.reference,r.amount_kobo,r.currency,r.quote_payload_hash,r.state,r.bank_code,r.authorization_url,r.initialization_claimed,'ACCT_fixture'::text,0::bigint;
    END $$;
    CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(p_attempt_id uuid)
    RETURNS TABLE(attempt_id uuid,reference text,amount_kobo bigint,currency text,quote_payload_hash text,state text,bank_code text,authorization_url text,initialization_claimed boolean,paystack_subaccount_code text,platform_fee_kobo bigint,split_retained_shipping_kobo bigint)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ DECLARE r record; BEGIN
      SELECT * INTO STRICT r FROM public.claim_storefront_redvault_payment_attempt_initialization(p_attempt_id);
      RETURN QUERY SELECT r.attempt_id,r.reference,r.amount_kobo,r.currency,r.quote_payload_hash,r.state,r.bank_code,r.authorization_url,r.initialization_claimed,'ACCT_fixture'::text,0::bigint,0::bigint;
    END $$;
  `);
  for (const filename of [
    '20260928120000_uba_redvault_private_pilot_policy.sql',
    '20260928120500_uba_redvault_private_pilot_order_guard.sql',
    '20260928121000_uba_redvault_private_pilot_attempt_guards.sql',
    '20260928121500_uba_redvault_private_pilot_rpc_wrappers.sql',
    '20260928122000_uba_redvault_private_pilot_fulfillment_guards.sql',
  ]) {
    sql(readFileSync(resolve(migrations, filename), 'utf8'));
  }
  sql(`DO $$ BEGIN
    IF (SELECT enabled FROM private.uba_redvault_live_pilot_policy WHERE singleton) IS NOT FALSE THEN
      RAISE EXCEPTION 'private_pilot_did_not_default_off';
    END IF;
    IF has_function_privilege('authenticated','private.configure_uba_redvault_live_pilot(boolean,uuid,timestamptz)','EXECUTE')
      OR has_function_privilege('anon','private.configure_uba_redvault_live_pilot(boolean,uuid,timestamptz)','EXECUTE')
      OR has_function_privilege('service_role','private.configure_uba_redvault_live_pilot(boolean,uuid,timestamptz)','EXECUTE')
      OR has_table_privilege('authenticated','private.uba_redvault_live_pilot_policy','SELECT')
      OR has_table_privilege('anon','private.uba_redvault_live_pilot_policy','SELECT')
      OR has_table_privilege('service_role','private.uba_redvault_live_pilot_policy','SELECT')
      OR NOT has_function_privilege('authenticated','public.reserve_storefront_redvault_payment_attempt_v3(uuid)','EXECUTE')
      OR has_function_privilege('anon','public.reserve_storefront_redvault_payment_attempt_v3(uuid)','EXECUTE')
      OR has_function_privilege('service_role','public.reserve_storefront_redvault_payment_attempt_v3(uuid)','EXECUTE')
      OR has_function_privilege('authenticated','public.claim_redvault_initialization_v3_pre_pilot(uuid)','EXECUTE')
      OR has_function_privilege('anon','public.claim_redvault_initialization_v3_pre_pilot(uuid)','EXECUTE')
      OR has_function_privilege('service_role','public.claim_redvault_initialization_v3_pre_pilot(uuid)','EXECUTE')
    THEN RAISE EXCEPTION 'private_pilot_grants_invalid'; END IF;
  END $$;`);
  sql(`
    BEGIN;
    INSERT INTO public.discount_codes(id, merchant_id, code, discount_type, discount_value, applies_to, is_active)
      VALUES ('22222222-2222-4222-8222-222222222222', '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'fixture', 'percentage', 5, 'all', true);
    INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current());
    INSERT INTO public.orders(id, merchant_id, customer_email, payment_method, payment_status, subtotal, discount_amount, total, tracking_token)
      VALUES ('11111111-1111-4111-8111-111111111111', '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'customer@example.test', 'uba_redvault', 'unpaid', 100, 5, 95, 'tracking-1');
    DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
    INSERT INTO private.uba_redvault_applications(
      id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash, quote_payload,
      customer_email, checkout_key, request_hash, discount_kobo, eligible_subtotal_kobo, status
    ) VALUES (
      '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      '44444444-4444-4444-8444-444444444444', repeat('a', 64), '{"productSubtotalKobo":10000}'::jsonb,
      'customer@example.test', 'concurrency-fixture', repeat('b', 64), 500, 10000, 'pending'
    );
    UPDATE private.uba_redvault_runtime SET enabled = true, paystack_bank_code = '033';
    COMMIT;
  `);
  const claims = `{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}`;
  const summary = await concurrentSql(
    `SET request.jwt.claims = '${claims}'; SET ROLE authenticated; SELECT order_id,total,currency,tracking_token,product_subtotal_kobo,eligible_subtotal_kobo,ineligible_subtotal_kobo,discount_kobo,tax_kobo,shipping_kobo,gift_wrapping_kobo,payable_kobo,mixed_basket FROM public.get_storefront_redvault_checkout_summary('11111111-1111-4111-8111-111111111111');`
  );
  if (
    !summary.includes(
      '11111111-1111-4111-8111-111111111111|95|NGN|tracking-1|10000|10000|0|500|0|0|0|9500|f'
    )
  ) {
    throw new Error(`persisted checkout summary was not returned: ${summary}`);
  }
  const nonpilotReplay = await concurrentSql(
    `SET request.jwt.claims = '${claims}'; SET ROLE authenticated; SELECT state FROM public.reserve_storefront_redvault_payment_attempt_v3('11111111-1111-4111-8111-111111111111');`
  );
  if (!nonpilotReplay.includes('created'))
    throw new Error(
      `non-pilot v3 reservation behavior changed while policy is disabled: ${nonpilotReplay}`
    );
  const reserveInput = `BEGIN; SELECT state FROM public.reserve_storefront_redvault_payment_attempt('11111111-1111-4111-8111-111111111111'); SELECT pg_sleep(0.2); COMMIT;`;
  const reserveResults = await Promise.all(
    [1, 2].map(() =>
      concurrentSql(
        `SET request.jwt.claims = '${claims}'; SET ROLE authenticated; ${reserveInput}`
      )
    )
  );
  if (reserveResults.some((result) => !result.includes('created'))) {
    throw new Error(
      `concurrent reserve did not return the single created attempt: ${reserveResults.join('|')}`
    );
  }
  const attemptId = sql(
    `SELECT id FROM private.uba_redvault_payment_attempts;`
  ).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (!attemptId)
    throw new Error('concurrent reserve did not create exactly one attempt');
  const claimInput = `BEGIN; SELECT initialization_claimed FROM public.claim_storefront_redvault_payment_attempt_initialization('${attemptId}'); SELECT pg_sleep(0.2); COMMIT;`;
  const claimResults = await Promise.all(
    [1, 2].map(() =>
      concurrentSql(
        `SET request.jwt.claims = '${claims}'; SET ROLE authenticated; ${claimInput}`
      )
    )
  );
  if (
    claimResults.filter((result) =>
      result.split('\n').some((line) => line.trim() === 't')
    ).length !== 1 ||
    claimResults.filter((result) =>
      result.split('\n').some((line) => line.trim() === 'f')
    ).length !== 1
  ) {
    throw new Error(
      `concurrent initialization claim did not produce one winner: ${claimResults.join('|')}`
    );
  }
}
