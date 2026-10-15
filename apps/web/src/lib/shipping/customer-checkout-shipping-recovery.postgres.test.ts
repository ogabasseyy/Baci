import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCustomerCheckoutShippingRecoveryTestDatabase } from '../../../../../supabase/tests/customer-checkout-shipping-recovery-test-harness.mjs';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import {
  RECOVERY_MERCHANT_ID as merchantId,
  RECOVERY_ORDER_ID as orderId,
  RECOVERY_OWNER_ID as ownerId,
  recoveryQuote as quote,
  type RecoveryQuote,
  recoveryActorAuth,
  recoveryConfirm,
  recoveryPrepare,
} from './customer-checkout-shipping-recovery.postgres.test-support';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'checkout shipping recovery PostgreSQL boundary',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase({
      beforeFix: process.env.BACI_SHIPPING_RECOVERY_BEFORE_FIX === '1',
    });
    beforeAll(async () => database.start(), 60000);
    afterAll(() => database.stop());
    function asActor(sql: string, actor = ownerId) {
      return database.query(
        `BEGIN; ${recoveryActorAuth(actor)} ${sql} ROLLBACK;`
      );
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
      value: RecoveryQuote = quote(),
      hash = fingerprint(),
      signed = createShippingQuoteRouteProof({
        action: 'prepare_customer_checkout_shipping_recovery',
        merchantId,
        subjectId: orderId,
        payload: { order_id: orderId, fingerprint: hash, quote: value },
      })
    ) {
      return recoveryPrepare(value, hash, signed);
    }
    function confirm(id: string) {
      return recoveryConfirm(id);
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
    it('coerces a legacy scalar destination into an address object on confirm', () => {
      const value = quote();
      const output = asActor(
        `UPDATE public.orders SET shipping_address = '"12 Test Street, Ikeja"'::jsonb WHERE id='${orderId}'; ${prepare(value)} ${confirm(value.id)} RESET ROLE;
      SELECT jsonb_typeof(shipping_address), shipping_address->>'latitude', shipping_address->>'city' FROM public.orders WHERE id='${orderId}';`
      );
      expect(output).toContain('object|6.6018|Ikeja');
    });
    it('projects surviving fulfillment quantities in the recovery context', () => {
      const output = asActor(
        `RESET ROLE; UPDATE public.order_items SET fulfillment_data = '{"fulfillmentQuantity": 0}'::jsonb WHERE order_id='${orderId}'; SET LOCAL ROLE authenticated;
      SELECT (item->>'quantity') || '|' || (item->>'fulfillment_quantity') FROM pg_catalog.jsonb_array_elements((public.get_customer_checkout_shipping_recovery_context('${orderId}') -> 'order' -> 'order_items')) AS item;`
      );
      const rows = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^\d+\|\d+$/.test(line));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row).toMatch(/\|0$/);
    });
    it('cascades recovery previews with the owning order and merchant', () => {
      const output = database.query(
        `SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid = 'private.customer_checkout_shipping_recovery_previews'::pg_catalog.regclass AND confdeltype = 'c';`
      );
      expect(output.trim().split('\n').at(-1)?.trim()).toBe('2');
    });
    it('purges only expired unconfirmed previews on retention sweep', () => {
      const staleId = '80000000-0000-4000-8000-000000000001';
      const auditId = '80000000-0000-4000-8000-000000000002';
      const output = database.query(`BEGIN;
      INSERT INTO private.customer_checkout_shipping_recovery_previews
        (id, order_id, merchant_id, actor_id, fingerprint, original_address, quote, expires_at, confirmed_at)
      VALUES
        ('${staleId}', '${orderId}', '${merchantId}', '${ownerId}', 'sweep', '{}', '{}', now() - interval '2 days', NULL),
        ('${auditId}', '${orderId}', '${merchantId}', '${ownerId}', 'sweep', '{}', '{}', now() - interval '2 days', now() - interval '1 day');
      SELECT public.cleanup_customer_checkout_shipping_recovery_previews() AS deleted;
      SELECT (SELECT count(*) FROM private.customer_checkout_shipping_recovery_previews WHERE id = '${staleId}') AS stale_remaining,
        (SELECT count(*) FROM private.customer_checkout_shipping_recovery_previews WHERE id = '${auditId}') AS audit_remaining;
      ROLLBACK;`);
      expect(output.trim().split('\n').at(-1)?.trim()).toBe('0|1');
    });
    it('redacts confirmed rows past the retention window on sweep', () => {
      const oldId = '80000000-0000-4000-8000-000000000003';
      const freshId = '80000000-0000-4000-8000-000000000004';
      const output = database.query(`BEGIN;
      INSERT INTO private.customer_checkout_shipping_recovery_previews
        (id, order_id, merchant_id, actor_id, fingerprint, original_address, quote, expires_at, confirmed_at)
      VALUES
        ('${oldId}', '${orderId}', '${merchantId}', '${ownerId}', 'sweep', '{"city":"Ikeja"}', '{"price":110}', now() - interval '100 days', now() - interval '100 days'),
        ('${freshId}', '${orderId}', '${merchantId}', '${ownerId}', 'sweep', '{"city":"Ikeja"}', '{"price":110}', now() - interval '100 days', now());
      SELECT public.cleanup_customer_checkout_shipping_recovery_previews();
      SELECT original_address::text || '|' || quote::text FROM private.customer_checkout_shipping_recovery_previews WHERE id IN ('${oldId}', '${freshId}') ORDER BY id;
      ROLLBACK;`);
      const rows = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('|'));
      expect(rows).toContain('{}|{"redacted": true}');
      expect(rows.some((line) => line.includes('Ikeja'))).toBe(true);
    });
    it('returns idempotent success when a committed confirmation is retried after redaction', () => {
      const value = quote();
      const output = asActor(
        `${prepare(value)} ${confirm(value.id)} RESET ROLE;
        SELECT public.cleanup_customer_checkout_shipping_recovery_previews(1000, '0 seconds', '0 seconds');
        SET LOCAL ROLE authenticated; ${confirm(value.id)} RESET ROLE;
        SELECT quote::text FROM private.customer_checkout_shipping_recovery_previews WHERE id='${value.id}';`
      );
      // Both the first commit and the post-redaction retry report success;
      // the stored quote payload is redacted by the sweep in between.
      expect(output.match(/"confirmed": true/g)?.length).toBe(2);
      expect(output).toContain('{"redacted": true}');
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
  }
);
