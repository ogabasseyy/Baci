import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCustomerCheckoutShippingRecoveryTestDatabase } from '../../../../../supabase/tests/customer-checkout-shipping-recovery-test-harness.mjs';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import {
  RECOVERY_MERCHANT_ID as merchantId,
  RECOVERY_ORDER_ID as orderId,
  recoveryActorAuth,
  recoveryConfirm,
  recoveryPrepare,
  recoveryQuote,
} from './customer-checkout-shipping-recovery.postgres.test-support';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'recovery delivery-method boundary after quote deletion',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase();
    beforeAll(() => database.start(), 60000);
    afterAll(() => database.stop());
    const context = `SELECT public.get_customer_checkout_shipping_recovery_context('${orderId}');`;
    function actor(sql: string) {
      return database.query(`BEGIN; ${recoveryActorAuth()} ${sql} ROLLBACK;`);
    }
    function prepare() {
      const value = recoveryQuote();
      const fingerprint = JSON.parse(
        actor(context).trim().split('\n').at(-1) ?? '{}'
      ).fingerprint;
      const proof = createShippingQuoteRouteProof({
        action: 'prepare_customer_checkout_shipping_recovery',
        merchantId,
        subjectId: orderId,
        payload: { order_id: orderId, fingerprint, quote: value },
      });
      return { id: value.id, sql: recoveryPrepare(value, fingerprint, proof) };
    }
    it.each([
      null,
      'door',
    ])('projects durable delivery method %s with no saved quote', (method) => {
      const output = database.query(
        `BEGIN; UPDATE public.orders SET delivery_method=${method === null ? 'NULL' : "'door'"}; ${recoveryActorAuth()} ${context} ROLLBACK;`
      );
      const data = JSON.parse(output.trim().split('\n').at(-1) ?? '{}');
      expect(data.quote_preference).toBeNull();
      expect(data.order.delivery_method).toBe(method);
    });
    it.each([
      'pickup_station',
      'pickup',
      'airport',
    ])('rejects %s in context and direct prepare/confirm RPCs without a quote', (method) => {
      const prepared = prepare();
      for (const sql of [context, prepared.sql, recoveryConfirm(prepared.id)]) {
        expect(() =>
          database.query(`BEGIN;
          ${sql === recoveryConfirm(prepared.id) ? `${recoveryActorAuth()} ${prepared.sql} RESET ROLE;` : ''}
          UPDATE public.orders SET delivery_method='${method}',selected_quote_id=NULL;
          ${recoveryActorAuth()} ${sql} ROLLBACK;`)
        ).toThrow(/shipping_recovery_unavailable/);
      }
    });
    it('also rejects an existing station quote when legacy delivery metadata is absent', () => {
      const prepared = prepare();
      expect(() =>
        database.query(`BEGIN; ${recoveryActorAuth()} ${prepared.sql} ${recoveryConfirm(prepared.id)}
        RESET ROLE; UPDATE public.shipping_quotes SET is_station_pickup=true WHERE id='${prepared.id}';
        ${recoveryActorAuth()} ${context} ROLLBACK;`)
      ).toThrow(/shipping_recovery_unavailable/);
    });
    it('blocks confirmation after delivery changes and preserves destination, paid funding and unconfirmed audit', () => {
      const prepared = prepare();
      const output =
        database.query(`BEGIN; ${recoveryActorAuth()} ${prepared.sql}
        RESET ROLE; UPDATE public.orders SET delivery_method='pickup_station';
        ${recoveryActorAuth()}
        DO $$ BEGIN
          ${recoveryConfirm(prepared.id).replace('SELECT ', 'PERFORM ')}
          RAISE EXCEPTION 'expected shipping_recovery_unavailable';
        EXCEPTION WHEN SQLSTATE '22023' THEN
          IF SQLERRM <> 'shipping_recovery_unavailable' THEN RAISE; END IF;
        END $$;
        RESET ROLE; SELECT shipping_address->>'address',selected_quote_id IS NULL,
          shipping_funding_source,shipping_fee,shipping_platform_retained_amount,
          (SELECT confirmed_at IS NULL FROM private.customer_checkout_shipping_recovery_previews WHERE id='${prepared.id}'),
          shipment_id IS NULL AND tracking_number IS NULL
          FROM public.orders WHERE id='${orderId}'; ROLLBACK;`);
      expect(output.trim().split('\n').at(-1)).toBe(
        '12 Test Street|t|customer_checkout|110|110|t|t'
      );
    });
  }
);
