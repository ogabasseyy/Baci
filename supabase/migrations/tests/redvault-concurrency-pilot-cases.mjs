import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Applies the pilot guard chain over the same ordered definitions as the
// smoke runner, then races activation, reservations, expiry, replay, and
// fulfillment/disable behavior.
export async function runConcurrencyPilotCases({
  concurrentSql,
  migrations,
  sql,
}) {
  // The legacy races above must run before the legacy RPC revocation. Every
  // pilot check below runs against the same ordered definitions as the
  // ordered migration smoke test.
  for (const filename of [
    '20260929100000_uba_redvault_pilot_legacy_and_shipment_guards.sql',
    '20261006120100_uba_redvault_pilot_review_followups.sql',
    '20261006130000_uba_redvault_pilot_permit_payment_completion.sql',
    '20261006140000_uba_redvault_pilot_product_boundary.sql',
    '20261006150000_uba_redvault_pilot_binding_and_cancel_guards.sql',
    '20261006160000_uba_redvault_pilot_activation_lock_and_policy_indexes.sql',
    '20261006170000_uba_redvault_pilot_reserve_lock_order.sql',
    '20261006180000_uba_redvault_pilot_savings_and_expiry_guards.sql',
    '20261006190000_uba_redvault_pilot_preserve_binding_after_disable.sql',
    '20261006190100_uba_redvault_pilot_preserved_binding_shipment_savings.sql',
    '20261006190200_uba_redvault_pilot_disabled_policy_staging_passthrough.sql',
    '20261006190300_uba_redvault_pilot_item_fulfillment_guard.sql',
    '20261006190400_uba_redvault_pilot_db_staging_mode.sql',
  ]) {
    sql(readFileSync(resolve(migrations, filename), 'utf8'));
  }
  sql(`
    INSERT INTO public.products(id,merchant_id,name,price) VALUES
      ('5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a','6b5cb8a4-5575-456c-b936-8cdfae30db74','Pilot activation race product',100);
    INSERT INTO public.orders(id,merchant_id,customer_email,payment_method,payment_status,subtotal,discount_amount,total,currency)
    VALUES ('5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b','6b5cb8a4-5575-456c-b936-8cdfae30db74','race@example.test','paystack','unpaid',100,0,100,'NGN');
  `);
  const activationRace = await Promise.all([
    concurrentSql(
      `DO $$ BEGIN PERFORM private.configure_uba_redvault_live_pilot(true,'5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a',pg_catalog.now()+interval '1 hour'); PERFORM pg_sleep(0.5); RAISE NOTICE 'CONFIGURE_OK'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'CONFIGURE_REJECTED:%',SQLERRM; END $$;`
    ),
    concurrentSql(
      `DO $$ BEGIN INSERT INTO public.order_items(id,order_id,line_id,product_id,price,quantity) VALUES ('5c5c5c5c-5c5c-4c5c-8c5c-5c5c5c5c5c5c','5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b',1,'5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a',100,1); PERFORM pg_sleep(0.5); RAISE NOTICE 'INSERT_OK'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'INSERT_REJECTED:%',SQLERRM; END $$;`
    ),
  ]);
  const configureOk = activationRace[0].includes('CONFIGURE_OK');
  const insertOk = activationRace[1].includes('INSERT_OK');
  if (
    configureOk === insertOk ||
    (!configureOk &&
      !activationRace[0].includes('redvault_pilot_product_not_dedicated')) ||
    (!insertOk &&
      !activationRace[1].includes('redvault_pilot_product_restricted'))
  ) {
    throw new Error(
      `pilot activation did not serialize against ordinary inserts: ${activationRace.join('|')}`
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
        INSERT INTO public.order_items(id,order_id,line_id,product_id,price,quantity)
        VALUES ('17171717-1717-4717-8717-171717171717','16161616-1616-4616-8616-161616161616',1,'55555555-5555-4555-8555-555555555555',90,1);
        INSERT INTO private.uba_redvault_applications(id,order_id,discount_code_id,merchant_id,quote_version_id,quote_payload_hash,quote_payload,customer_email,user_id,checkout_key,request_hash,discount_kobo,eligible_subtotal_kobo,status)
        VALUES ('18181818-1818-4818-8818-181818181818','16161616-1616-4616-8616-161616161616','22222222-2222-4222-8222-222222222222','6b5cb8a4-5575-456c-b936-8cdfae30db74','19191919-1919-4919-8919-191919191919',repeat('3',64),'{}','pilot@example.test','70261bce-d358-45a4-9ede-8b9d71fb3bd9','invalid-price',repeat('4',64),500,10000,'pending');
        DELETE FROM private.uba_redvault_write_context WHERE transaction_id=pg_catalog.txid_current();
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
    BEGIN;
    INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current());
    INSERT INTO public.order_items(id,order_id,line_id,product_id,price,quantity)
    VALUES ('88888888-8888-4888-8888-888888888888','66666666-6666-4666-8666-666666666666',1,'55555555-5555-4555-8555-555555555555',100,1),
      ('99999999-9999-4999-8999-999999999999','77777777-7777-4777-8777-777777777777',1,'55555555-5555-4555-8555-555555555555',100,1);
    DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
    COMMIT;
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
      INSERT INTO public.order_items(id,order_id,line_id,product_id,price,quantity)
      VALUES ('21212121-2121-4121-8121-212121212121','20202020-2020-4020-8020-202020202020',1,'55555555-5555-4555-8555-555555555555',100,1);
      INSERT INTO private.uba_redvault_applications(id,order_id,discount_code_id,merchant_id,quote_version_id,quote_payload_hash,quote_payload,customer_email,user_id,checkout_key,request_hash,discount_kobo,eligible_subtotal_kobo,status)
      VALUES ('22232323-2223-4223-8223-222323232323','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','6b5cb8a4-5575-456c-b936-8cdfae30db74','23232323-2323-4323-8323-232323232323',repeat('5',64),'{}','pilot@example.test','70261bce-d358-45a4-9ede-8b9d71fb3bd9','after-cap',repeat('6',64),500,10000,'pending');
      DELETE FROM private.uba_redvault_write_context WHERE transaction_id=pg_catalog.txid_current();
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
}
