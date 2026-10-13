import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCustomerCheckoutShippingRecoveryTestDatabase } from '../../../../../supabase/tests/customer-checkout-shipping-recovery-test-harness.mjs';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

const merchantId = '10000000-0000-4000-8000-000000000001';
const orderId = '40000000-0000-4000-8000-000000000001';
const ownerId = '20000000-0000-4000-8000-000000000001';
function json(value: unknown) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}
function quote() {
  return {
    id: randomUUID(),
    merchant_id: merchantId,
    session_id: orderId,
    provider: 'GIGL',
    service_tier: 'standard',
    carrier_name: 'GIG Logistics',
    price: 110,
    provider_cost: 100,
    platform_margin: 10,
    platform_margin_bps: 1000,
    pricing_version: 'gigl_platform_margin_v1',
    currency: 'NGN',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    quote_request: {
      merchantId,
      shipmentType: 'domestic',
      receiver: {
        name: 'Test Customer',
        phone: '08000000000',
        address: '12 Test Street',
        city: 'Ikeja',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
        latitude: 6.6018,
        longitude: 3.3515,
      },
      items: [{ name: 'Phone', quantity: 1, weight: 1, value: 1000 }],
    },
  };
}
describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'checkout shipping recovery PostgreSQL boundary',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase({
      beforeFix: process.env.BACI_SHIPPING_RECOVERY_BEFORE_FIX === '1',
    });
    beforeAll(async () => database.start(), 60000);
    afterAll(() => database.stop());
    function asActor(sql: string, actor = ownerId) {
      return database.query(`BEGIN; SELECT set_config('request.jwt.claim.role','authenticated',true);
      SELECT set_config('request.jwt.claim.sub','${actor}',true); SET LOCAL ROLE authenticated; ${sql} ROLLBACK;`);
    }
    function fingerprint() {
      return (
        asActor(
          `SELECT public.get_customer_checkout_shipping_recovery_context('${orderId}')->>'fingerprint';`
        )
          .trim()
          .split('\n')
          .at(-1) ?? ''
      );
    }
    function prepare(
      value = quote(),
      hash = fingerprint(),
      signed = createShippingQuoteRouteProof({
        action: 'prepare_customer_checkout_shipping_recovery',
        merchantId,
        subjectId: orderId,
        payload: { order_id: orderId, fingerprint: hash, quote: value },
      })
    ) {
      return `SELECT public.prepare_customer_checkout_shipping_recovery('${orderId}','${hash}',${json(value)},${json(signed)});`;
    }
    function confirm(id: string) {
      return `SELECT public.confirm_customer_checkout_shipping_recovery('${orderId}','${id}',true);`;
    }
    it('stages a signed quote without changing destination, quote binding or funding', () => {
      const value = quote();
      expect(
        asActor(
          `${prepare(value)} RESET ROLE; SELECT shipping_address ? 'latitude', selected_quote_id IS NULL,shipping_funding_source FROM public.orders WHERE id='${orderId}';`
        )
      ).toContain('f|t|customer_checkout');
      expect(
        database.query('SELECT count(*) FROM public.shipping_quotes;').trim()
      ).toBe('0');
    });
    it('explicitly confirms the pin and quote atomically, preserves checkout economics and supports retry', () => {
      const value = quote();
      const output =
        asActor(`${prepare(value)} ${confirm(value.id)} ${confirm(value.id)} RESET ROLE;
      SELECT shipping_address->>'latitude', selected_quote_id, shipping_funding_source,
      shipping_platform_retained_amount,shipping_provider_cost,shipping_platform_margin,
      shipment_id IS NULL,tracking_number IS NULL FROM public.orders WHERE id='${orderId}';`);
      expect(output).toContain(
        `6.6018|${value.id}|customer_checkout|110|90|20|t|t`
      );
      expect(output.match(/"confirmed": true/g)?.length).toBe(2);
    });
    it('rejects altered proofs and quote payloads', () => {
      const value = quote();
      const hash = fingerprint();
      const signed = createShippingQuoteRouteProof({
        action: 'prepare_customer_checkout_shipping_recovery',
        merchantId,
        subjectId: orderId,
        payload: { order_id: orderId, fingerprint: hash, quote: value },
      });
      expect(() =>
        asActor(prepare({ ...value, price: 120 }, hash, signed))
      ).toThrow(/invalid_shipping_quote_route_proof/);
    });
    it('rejects an owner from another merchant', () => {
      expect(() =>
        asActor(
          `SELECT public.get_customer_checkout_shipping_recovery_context('${orderId}');`,
          '20000000-0000-4000-8000-000000000002'
        )
      ).toThrow(/forbidden/);
    });
    it('rejects changed rates without changing payment policy', () => {
      expect(() => asActor(prepare({ ...quote(), price: 120 }))).toThrow(
        /shipping_recovery_price_changed/
      );
    });
    it.each([
      `UPDATE public.orders SET shipping_address='{"address":"99 Changed Street"}' WHERE id='${orderId}';`,
      `UPDATE public.order_items SET quantity=2;`,
      `UPDATE public.products SET weight_value=2;`,
      `UPDATE public.merchants SET user_id='20000000-0000-4000-8000-000000000002' WHERE id='${merchantId}';`,
      `UPDATE public.orders SET payment_status='refunded' WHERE id='${orderId}';`,
      `UPDATE public.orders SET shipment_booking_lock_token='90000000-0000-4000-8000-000000000001' WHERE id='${orderId}';`,
    ])('rejects stale preview after relevant input changes: %s', (change) => {
      const value = quote();
      expect(() =>
        asActor(
          `${prepare(value)} RESET ROLE; ${change} SET LOCAL ROLE authenticated; ${confirm(value.id)}`
        )
      ).toThrow(
        /shipping_recovery_stale|order_refunded|shipping_recovery_unavailable|forbidden/
      );
    });
    it('requires explicit confirmation', () => {
      const value = quote();
      expect(() =>
        asActor(
          `${prepare(value)} SELECT public.confirm_customer_checkout_shipping_recovery('${orderId}','${value.id}',false);`
        )
      ).toThrow(/destination_confirmation_required/);
    });
    it('rejects an expired staged preview', () => {
      const value = quote();
      expect(() =>
        asActor(
          `${prepare(value)} RESET ROLE; UPDATE private.customer_checkout_shipping_recovery_previews SET expires_at=now()-interval '1 second'; SET LOCAL ROLE authenticated; ${confirm(value.id)}`
        )
      ).toThrow(/shipping_recovery_expired/);
    });
    it('rejects missing coordinates even on a server-signed preview', () => {
      const value = quote();
      const invalid = {
        ...value,
        quote_request: {
          ...value.quote_request,
          receiver: { ...value.quote_request.receiver, latitude: null },
        },
      };
      expect(() =>
        asActor(prepare(invalid as unknown as ReturnType<typeof quote>))
      ).toThrow(/invalid_shipping_recovery_destination/);
    });
    it('keeps preview payload and private helpers inaccessible to clients', () => {
      const output = database
        .query(
          `SELECT has_schema_privilege('authenticated','private','USAGE'),has_table_privilege('authenticated','private.customer_checkout_shipping_recovery_previews','SELECT'),has_function_privilege('anon','public.confirm_customer_checkout_shipping_recovery(uuid,uuid,boolean)','EXECUTE');`
        )
        .trim();
      expect(output).toBe('f|f|f');
    });
    it('rejects a settling partial refund before confirmation', () => {
      const value = quote();
      expect(() =>
        asActor(`${prepare(value)} RESET ROLE;
        INSERT INTO private.uba_redvault_payment_attempts VALUES ('80000000-0000-4000-8000-000000000001','${orderId}');
        INSERT INTO private.uba_redvault_refunds VALUES ('80000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','merchandise_units','processing');
        SET LOCAL ROLE authenticated; ${confirm(value.id)}`)
      ).toThrow(/shipping_recovery_unavailable/);
    });
    it('requires the existing retention boundary before preserving paid economics', () => {
      expect(() =>
        asActor(`RESET ROLE; DELETE FROM public.merchant_settlements;
        SET LOCAL ROLE authenticated; SELECT public.get_customer_checkout_shipping_recovery_context('${orderId}');`)
      ).toThrow(/shipping_recovery_funding_not_ready/);
    });
    it('rolls back destination changes when the quote writer rejects invalid economics', () => {
      const value = { ...quote(), platform_margin: 11 };
      const output = asActor(`${prepare(value)} DO $$ BEGIN
        PERFORM public.confirm_customer_checkout_shipping_recovery('${orderId}','${value.id}',true);
        EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END $$;
        RESET ROLE; SELECT shipping_address ? 'latitude',selected_quote_id IS NULL,
          (SELECT count(*) FROM public.shipping_quotes),
          (SELECT count(*) FROM private.customer_checkout_shipping_recovery_previews WHERE confirmed_at IS NOT NULL)
        FROM public.orders WHERE id='${orderId}';`);
      expect(output).toContain('f|t|0|0');
    });
    it('serializes simultaneous confirmations into one quote and one audit record', async () => {
      const value = quote();
      const auth = `SELECT set_config('request.jwt.claim.role','authenticated',true);
        SELECT set_config('request.jwt.claim.sub','${ownerId}',true); SET LOCAL ROLE authenticated;`;
      database.query(`BEGIN; ${auth} ${prepare(value)} COMMIT;`);
      const results = await Promise.all([
        database.queryAsync(
          `BEGIN; ${auth} ${confirm(value.id)} SELECT pg_sleep(0.15); COMMIT;`
        ),
        database.queryAsync(`BEGIN; ${auth} ${confirm(value.id)} COMMIT;`),
      ]);
      for (const result of results)
        expect(result).toContain('"confirmed": true');
      expect(
        database
          .query(`SELECT
        (SELECT count(*) FROM public.shipping_quotes WHERE id='${value.id}'),
        (SELECT count(*) FROM public.shipping_quote_attestations WHERE quote_id='${value.id}'),
        (SELECT count(*) FROM private.customer_checkout_shipping_recovery_previews WHERE id='${value.id}' AND confirmed_at IS NOT NULL);`)
          .trim()
      ).toBe('1|1|1');
    });
    it('blocks concurrent product edits until context and confirmation release their input locks', async () => {
      const value = quote();
      const auth = `SELECT set_config('request.jwt.claim.role','authenticated',true);
        SELECT set_config('request.jwt.claim.sub','${ownerId}',true); SET LOCAL ROLE authenticated;`;
      database.query(`BEGIN; ${auth} ${prepare(value)} COMMIT;`);
      const confirmer = database.queryAsync(`BEGIN; ${auth}
        SELECT public.get_customer_checkout_shipping_recovery_context('${orderId}');
        SELECT public.confirm_customer_checkout_shipping_recovery('${orderId}','${value.id}',true);
        SELECT pg_sleep(1); COMMIT;`);
      // Observe the relation lock before starting the editor, rather than
      // guessing transaction timing from a fixed client delay.
      let locked = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        locked =
          database
            .query(`SELECT EXISTS(SELECT 1 FROM pg_locks
          WHERE relation='public.products'::regclass AND mode='RowShareLock' AND granted);`)
            .trim() === 't';
        if (locked) break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
      const editor =
        database.queryAsync(`SET application_name='recovery_product_editor';
        UPDATE public.products SET weight_value=2 RETURNING weight_value;`);
      let blocked = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        blocked =
          database
            .query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE application_name='recovery_product_editor' AND wait_event_type='Lock');`)
            .trim() === 't';
        if (blocked) break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
      const results = await Promise.all([confirmer, editor]);
      expect(locked).toBe(true);
      expect(blocked).toBe(true);
      expect(results[0]).toContain('"confirmed": true');
      expect(results[1].trim()).toBe('2');
    });
  }
);
