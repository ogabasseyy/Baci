import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(directory, '..');
const root = mkdtempSync(resolve(tmpdir(), 'baci-redvault-attempt-'));
const port = '55480';

function run(name, args, input) {
  const result = spawnSync(`/opt/homebrew/bin/${name}`, args, {
    encoding: 'utf8',
    input,
    timeout: 60000,
  });
  if (result.status !== 0) {
    throw new Error(`${name} failed: ${result.stderr}\n${result.stdout}`);
  }
  return result.stdout;
}

function sql(input) {
  return run(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      root,
      '-p',
      port,
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    input
  );
}

function concurrentSql(input) {
  return new Promise((resolveResult, reject) => {
    const process = spawn('/opt/homebrew/bin/psql', [
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      root,
      '-p',
      port,
      '-U',
      'postgres',
      '-d',
      'postgres',
    ]);
    let output = '';
    let error = '';
    process.stdout.on('data', (value) => {
      output += value;
    });
    process.stderr.on('data', (value) => {
      error += value;
    });
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) resolveResult(`${output}\n${error}`);
      else reject(new Error(error));
    });
    process.stdin.end(input);
  });
}

let running = false;
try {
  chmodSync(root, 0o700);
  run('initdb', [
    '-D',
    resolve(root, 'data'),
    '-U',
    'postgres',
    '--auth=trust',
    '--no-locale',
  ]);
  run('pg_ctl', [
    '-D',
    resolve(root, 'data'),
    '-l',
    resolve(root, 'postgres.log'),
    '-o',
    `-k ${root} -p ${port} -c listen_addresses='' -c max_connections=12 -c shared_buffers=32MB`,
    '-w',
    'start',
  ]);
  running = true;
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
    CREATE FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(p_order_id uuid)
    RETURNS TABLE(attempt_id uuid,reference text,amount_kobo bigint,currency text,quote_payload_hash text,state text,bank_code text,authorization_url text,paystack_subaccount_code text,platform_fee_kobo bigint)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ DECLARE r record; BEGIN
      SELECT * INTO STRICT r FROM public.reserve_storefront_redvault_payment_attempt(p_order_id);
      RETURN QUERY SELECT r.attempt_id,r.reference,r.amount_kobo,r.currency,r.quote_payload_hash,r.state,r.bank_code,r.authorization_url,'ACCT_fixture'::text,0::bigint;
    END $$;
    CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(p_attempt_id uuid)
    RETURNS TABLE(attempt_id uuid,reference text,amount_kobo bigint,currency text,quote_payload_hash text,state text,bank_code text,authorization_url text,initialization_claimed boolean,paystack_subaccount_code text,platform_fee_kobo bigint,split_retained_shipping_kobo bigint)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ DECLARE r record; BEGIN
      SELECT * INTO STRICT r FROM public.claim_storefront_redvault_payment_attempt_initialization(p_attempt_id);
      RETURN QUERY SELECT r.attempt_id,r.reference,r.amount_kobo,r.currency,r.quote_payload_hash,r.state,r.bank_code,r.authorization_url,r.initialization_claimed,'ACCT_fixture'::text,0::bigint,0::bigint;
    END $$;
  `);
  sql(
    readFileSync(
      resolve(migrations, '20260928120000_uba_redvault_private_live_pilot.sql'),
      'utf8'
    )
  );
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
  sql(`
    INSERT INTO public.products(id,merchant_id,name,price) VALUES
      ('55555555-5555-4555-8555-555555555555','6b5cb8a4-5575-456c-b936-8cdfae30db74','Dedicated pilot product',100);
    SELECT private.configure_uba_redvault_live_pilot(true,'55555555-5555-4555-8555-555555555555',pg_catalog.now()+interval '1 hour');
    DO $$ BEGIN
      BEGIN
        INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current());
        INSERT INTO public.orders(id,merchant_id,customer_email,payment_method,payment_status,subtotal,discount_amount,total,currency)
        VALUES ('16161616-1616-4616-8616-161616161616','6b5cb8a4-5575-456c-b936-8cdfae30db74','pilot@example.test','uba_redvault','unpaid',90,5,85,'NGN');
        DELETE FROM private.uba_redvault_write_context WHERE transaction_id=pg_catalog.txid_current();
        INSERT INTO public.order_items(id,order_id,line_id,product_id,price,quantity)
        VALUES ('17171717-1717-4717-8717-171717171717','16161616-1616-4616-8616-161616161616',1,'55555555-5555-4555-8555-555555555555',90,1);
        INSERT INTO private.uba_redvault_applications(id,order_id,discount_code_id,merchant_id,quote_version_id,quote_payload_hash,quote_payload,customer_email,user_id,checkout_key,request_hash,discount_kobo,eligible_subtotal_kobo,status)
        VALUES ('18181818-1818-4818-8818-181818181818','16161616-1616-4616-8616-161616161616','22222222-2222-4222-8222-222222222222','6b5cb8a4-5575-456c-b936-8cdfae30db74','19191919-1919-4919-8919-191919191919',repeat('3',64),'{}','pilot@example.test','70261bce-d358-45a4-9ede-8b9d71fb3bd9','invalid-price',repeat('4',64),500,10000,'pending');
        RAISE EXCEPTION 'invalid pilot draft was accepted';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT IN ('redvault_pilot_order_binding_mismatch','invalid pilot draft was accepted') THEN RAISE; END IF;
        IF SQLERRM = 'invalid pilot draft was accepted' THEN RAISE; END IF;
      END;
    END $$;
    DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.orders WHERE id='16161616-1616-4616-8616-161616161616') THEN RAISE EXCEPTION 'invalid pilot draft left an order'; END IF; END $$;
    BEGIN;
    INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current());
    INSERT INTO public.orders(id,merchant_id,customer_email,payment_method,payment_status,subtotal,discount_amount,total,currency,tracking_token)
    VALUES
      ('66666666-6666-4666-8666-666666666666','6b5cb8a4-5575-456c-b936-8cdfae30db74','pilot@example.test','uba_redvault','unpaid',100,5,95,'NGN','pilot-1'),
      ('77777777-7777-4777-8777-777777777777','6b5cb8a4-5575-456c-b936-8cdfae30db74','pilot@example.test','uba_redvault','unpaid',100,5,95,'NGN','pilot-2');
    DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
    COMMIT;
    INSERT INTO public.order_items(id,order_id,line_id,product_id,price,quantity)
    VALUES ('88888888-8888-4888-8888-888888888888','66666666-6666-4666-8666-666666666666',1,'55555555-5555-4555-8555-555555555555',100,1),
      ('99999999-9999-4999-8999-999999999999','77777777-7777-4777-8777-777777777777',1,'55555555-5555-4555-8555-555555555555',100,1);
    INSERT INTO private.uba_redvault_applications(id,order_id,discount_code_id,merchant_id,quote_version_id,quote_payload_hash,quote_payload,customer_email,user_id,checkout_key,request_hash,discount_kobo,eligible_subtotal_kobo,status)
    VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','6b5cb8a4-5575-456c-b936-8cdfae30db74','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('c',64),'{}','pilot@example.test','70261bce-d358-45a4-9ede-8b9d71fb3bd9','pilot-one',repeat('d',64),500,10000,'pending'),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','77777777-7777-4777-8777-777777777777','22222222-2222-4222-8222-222222222222','6b5cb8a4-5575-456c-b936-8cdfae30db74','dddddddd-dddd-4ddd-8ddd-dddddddddddd',repeat('e',64),'{}','pilot@example.test','70261bce-d358-45a4-9ede-8b9d71fb3bd9','pilot-two',repeat('f',64),500,10000,'pending');
    INSERT INTO private.uba_redvault_line_allocations(application_id,order_item_id,line_id,unit_ordinal,allocation_kobo,product_id,unit_price_kobo,vat_rate_bp,tax_basis)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','88888888-8888-4888-8888-888888888888',1,1,10000,'55555555-5555-4555-8555-555555555555',10000,0,'exclusive'),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','99999999-9999-4999-8999-999999999999',1,1,10000,'55555555-5555-4555-8555-555555555555',10000,0,'exclusive');
  `);
  const pilotClaims = `{"sub":"70261bce-d358-45a4-9ede-8b9d71fb3bd9","role":"authenticated","storefront_redvault_customer_email":"pilot@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}`;
  const otherUserClaims = `{"sub":"15151515-1515-4515-8515-151515151515","role":"authenticated","storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}`;
  const otherUserResult = await concurrentSql(
    `SET request.jwt.claims = '${otherUserClaims}'; SET ROLE authenticated; DO $$ DECLARE rejection text; BEGIN BEGIN PERFORM * FROM public.reserve_storefront_redvault_payment_attempt_v3('11111111-1111-4111-8111-111111111111'); EXCEPTION WHEN OTHERS THEN rejection := SQLERRM; END; IF rejection IS DISTINCT FROM 'redvault_pilot_order_binding_mismatch' THEN RAISE EXCEPTION 'enabled_pilot_other_user_not_rejected:%',rejection; END IF; RAISE NOTICE 'OTHER_USER_REJECTED'; END $$;`
  );
  if (!otherUserResult.includes('OTHER_USER_REJECTED'))
    throw new Error(
      `other-user enabled-policy RPC guard failed: ${otherUserResult}`
    );
  sql(`DO $$ DECLARE rejection text; BEGIN
    BEGIN UPDATE public.orders SET wallet_amount_used=1 WHERE id='66666666-6666-4666-8666-666666666666'; EXCEPTION WHEN OTHERS THEN rejection:=SQLERRM; END;
    IF rejection IS DISTINCT FROM 'redvault_pilot_wallet_or_savings_credit_blocked' THEN RAISE EXCEPTION 'pilot_wallet_credit_not_rejected:%',rejection; END IF;
    rejection := NULL;
    BEGIN INSERT INTO public.customer_savings_redemptions(order_id,merchant_id,amount) VALUES ('66666666-6666-4666-8666-666666666666','6b5cb8a4-5575-456c-b936-8cdfae30db74',1); EXCEPTION WHEN OTHERS THEN rejection:=SQLERRM; END;
    IF rejection IS DISTINCT FROM 'redvault_pilot_wallet_or_savings_credit_blocked' THEN RAISE EXCEPTION 'pilot_savings_credit_not_rejected:%',rejection; END IF;
  END $$;`);
  const pilotReserve = (orderId) =>
    `SET request.jwt.claims = '${pilotClaims}'; SET ROLE authenticated; DO $$ BEGIN PERFORM * FROM public.reserve_storefront_redvault_payment_attempt_v3('${orderId}'); RAISE NOTICE 'PILOT_RESERVED'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PILOT_REJECTED:%',SQLERRM; END $$;`;
  const pilotRace = await Promise.all([
    concurrentSql(pilotReserve('66666666-6666-4666-8666-666666666666')),
    concurrentSql(pilotReserve('77777777-7777-4777-8777-777777777777')),
  ]);
  if (
    pilotRace.filter((result) => result.includes('PILOT_RESERVED')).length !==
      1 ||
    pilotRace.filter((result) =>
      result.includes('redvault_pilot_attempt_cap_reached')
    ).length !== 1
  ) {
    throw new Error(
      `pilot-wide concurrent attempt cap failed: ${pilotRace.join('|')}`
    );
  }
  sql(`DO $$ BEGIN
    BEGIN
      INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current());
      INSERT INTO public.orders(id,merchant_id,customer_email,payment_method,payment_status,subtotal,discount_amount,total,currency)
      VALUES ('20202020-2020-4020-8020-202020202020','6b5cb8a4-5575-456c-b936-8cdfae30db74','pilot@example.test','uba_redvault','unpaid',100,5,95,'NGN');
      DELETE FROM private.uba_redvault_write_context WHERE transaction_id=pg_catalog.txid_current();
      INSERT INTO public.order_items(id,order_id,line_id,product_id,price,quantity)
      VALUES ('21212121-2121-4121-8121-212121212121','20202020-2020-4020-8020-202020202020',1,'55555555-5555-4555-8555-555555555555',100,1);
      INSERT INTO private.uba_redvault_applications(id,order_id,discount_code_id,merchant_id,quote_version_id,quote_payload_hash,quote_payload,customer_email,user_id,checkout_key,request_hash,discount_kobo,eligible_subtotal_kobo,status)
      VALUES ('22232323-2223-4223-8223-222323232323','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','6b5cb8a4-5575-456c-b936-8cdfae30db74','23232323-2323-4323-8323-232323232323',repeat('5',64),'{}','pilot@example.test','70261bce-d358-45a4-9ede-8b9d71fb3bd9','after-cap',repeat('6',64),500,10000,'pending');
      RAISE EXCEPTION 'after-cap pilot order was accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT IN ('redvault_pilot_attempt_cap_reached','after-cap pilot order was accepted') THEN RAISE; END IF;
      IF SQLERRM = 'after-cap pilot order was accepted' THEN RAISE; END IF;
    END;
  END $$;
  DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.orders WHERE id='20202020-2020-4020-8020-202020202020') THEN RAISE EXCEPTION 'after-cap draft rollback left order'; END IF; END $$;`);
  const winnerOrderId = sql(
    `SELECT reserved_order_id FROM private.uba_redvault_live_pilot_policy WHERE singleton;`
  ).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  const winnerAttemptId = sql(
    `SELECT reserved_attempt_id FROM private.uba_redvault_live_pilot_policy WHERE singleton;`
  ).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (!winnerOrderId || !winnerAttemptId)
    throw new Error('pilot race did not persist the order and attempt binding');
  sql(
    `UPDATE private.uba_redvault_payment_attempts SET state='initialized',authorization_url='https://paystack.test/authorization' WHERE id='${winnerAttemptId}'; UPDATE private.uba_redvault_live_pilot_policy SET expires_at=pg_catalog.now()-interval '1 second' WHERE singleton;`
  );
  const expiredReserve = await concurrentSql(pilotReserve(winnerOrderId));
  if (!expiredReserve.includes('redvault_pilot_disabled_or_expired'))
    throw new Error(
      `expired initialized attempt was replayable: ${expiredReserve}`
    );
  const expiredClaim = await concurrentSql(
    `SET request.jwt.claims = '${pilotClaims}'; SET ROLE authenticated; DO $$ BEGIN PERFORM * FROM public.claim_storefront_redvault_payment_attempt_initialization_v3('${winnerAttemptId}'); RAISE NOTICE 'PILOT_CLAIMED'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PILOT_REJECTED:%',SQLERRM; END $$;`
  );
  if (!expiredClaim.includes('redvault_pilot_disabled_or_expired'))
    throw new Error(
      `expired initialization claim was accepted: ${expiredClaim}`
    );
  sql(
    `UPDATE private.uba_redvault_live_pilot_policy SET expires_at=pg_catalog.now()+interval '1 hour' WHERE singleton;`
  );
  const replay = await concurrentSql(pilotReserve(winnerOrderId));
  if (!replay.includes('PILOT_RESERVED'))
    throw new Error(`same-order reservation replay failed: ${replay}`);
  sql(
    `DO $$ BEGIN IF (SELECT count(*) FROM private.uba_redvault_payment_attempts WHERE order_id IN ('66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777')) <> 1 THEN RAISE EXCEPTION 'pilot_attempt_count_not_one'; END IF; END $$;`
  );
  sql(
    `UPDATE private.uba_redvault_applications SET status='approved' WHERE order_id='${winnerOrderId}'; UPDATE private.uba_redvault_payment_attempts SET state='approved' WHERE id='${winnerAttemptId}'; DO $$ BEGIN UPDATE public.orders SET shipping_status='shipped' WHERE id='${winnerOrderId}'; RAISE EXCEPTION 'pilot_fulfillment_was_allowed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'redvault_pilot_physical_fulfillment_blocked' THEN RAISE; END IF; END $$;`
  );
  sql(`SELECT private.configure_uba_redvault_live_pilot(false,NULL,NULL);`);
  sql(
    `DO $$ BEGIN UPDATE public.orders SET shipping_provider='manual' WHERE id='${winnerOrderId}'; RAISE EXCEPTION 'disabled_pilot_binding_lost'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'redvault_pilot_physical_fulfillment_blocked' THEN RAISE; END IF; END $$; DO $$ BEGIN PERFORM private.configure_uba_redvault_live_pilot(true,'55555555-5555-4555-8555-555555555555',pg_catalog.now()+interval '1 hour'); RAISE EXCEPTION 'consumed_pilot_cap_was_reset'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'redvault_pilot_consumed_binding_immutable' THEN RAISE; END IF; END $$;`
  );
  process.stdout.write(
    'Private pilot concurrent protected reservations produced one attempt; same-order replay was safe.\n'
  );
  process.stdout.write(
    'Concurrent REDVAULT reserve produced one attempt and one initialization claim.\n'
  );
} finally {
  if (running)
    run('pg_ctl', ['-D', resolve(root, 'data'), '-m', 'fast', '-w', 'stop']);
  rmSync(root, { force: true, recursive: true });
  process.stdout.write('Owned temporary cluster stopped and removed.\n');
}
