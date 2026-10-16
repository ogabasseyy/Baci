import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createCustomerCheckoutShippingRecoveryTestDatabase } from '../../../../../supabase/tests/customer-checkout-shipping-recovery-test-harness.mjs';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import {
  RECOVERY_MERCHANT_ID as merchantId,
  RECOVERY_ORDER_ID as orderId,
  type RecoveryQuote,
  recoveryActorAuth,
  recoveryConfirm,
  recoveryJson,
  recoveryPrepare,
  recoveryQuote,
} from './customer-checkout-shipping-recovery.postgres.test-support';
import { resolveRecoveryQuoteReceiver } from './resolve-recovery-quote-receiver';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

const original = {
  address: 'Old destination',
  address_line1: 'Old destination',
  address_line2: 'Old unit',
  city: 'Ikeja',
  state: 'Lagos',
  postalCode: '900001',
  postal_code: '900001',
};

describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'recovery confirmation legacy address aliases',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase();
    beforeAll(() => database.start(), 60000);
    afterAll(() => database.stop());
    beforeEach(() =>
      database.query(
        `UPDATE public.orders SET shipping_address=${recoveryJson(original)} WHERE id='${orderId}';`
      )
    );
    function asActor(sql: string) {
      return database.query(`BEGIN; ${recoveryActorAuth()} ${sql} ROLLBACK;`);
    }
    function prepare(value: RecoveryQuote) {
      const hash =
        asActor(
          `SELECT public.get_customer_checkout_shipping_recovery_context('${orderId}')->>'fingerprint';`
        )
          .trim()
          .split('\n')
          .at(-1) ?? '';
      const proof = createShippingQuoteRouteProof({
        action: 'prepare_customer_checkout_shipping_recovery',
        merchantId,
        subjectId: orderId,
        payload: { order_id: orderId, fingerprint: hash, quote: value },
      });
      return recoveryPrepare(value, hash, proof);
    }
    function snapshot(quoteId: string) {
      return `RESET ROLE; SELECT pg_catalog.jsonb_build_object(
        'address',o.shipping_address,'funding',o.shipping_funding_source,
        'fee',o.shipping_fee,'retained',o.shipping_platform_retained_amount,
        'cost',o.shipping_provider_cost,'margin',o.shipping_platform_margin,
        'unbooked',o.shipment_id IS NULL AND o.tracking_number IS NULL,
        'original',(SELECT original_address FROM private.customer_checkout_shipping_recovery_previews WHERE id='${quoteId}'),
        'confirmed',(SELECT count(*) FROM private.customer_checkout_shipping_recovery_previews WHERE confirmed_at IS NOT NULL))
        FROM public.orders o WHERE id='${orderId}';`;
    }
    function result(output: string) {
      return JSON.parse(output.trim().split('\n').at(-1) ?? 'null');
    }

    it('replaces legacy aliases atomically and keeps original audit and paid snapshots on retry', () => {
      const base = recoveryQuote();
      const value = {
        ...base,
        quote_request: {
          ...base.quote_request,
          receiver: { ...base.quote_request.receiver, postalCode: '100002' },
        },
      };
      const output = asActor(
        `${prepare(value)} ${recoveryConfirm(value.id)} ${recoveryConfirm(value.id)} ${snapshot(value.id)}`
      );
      const saved = result(output);
      expect(saved.address).toMatchObject({
        address: '12 Test Street',
        address_line1: '12 Test Street',
        postalCode: '100002',
        postal_code: '100002',
        latitude: 6.6018,
        longitude: 3.3515,
      });
      expect(saved.address).not.toHaveProperty('address_line2');
      expect(saved.original).toEqual(original);
      expect(saved).toMatchObject({
        funding: 'customer_checkout',
        fee: 110,
        retained: 110,
        cost: 90,
        margin: 20,
        unbooked: true,
        confirmed: 1,
      });
      expect(output.match(/"confirmed": true/g)).toHaveLength(2);
    });

    it('removes stale postcode aliases when the validated replacement quote has no postcode', () => {
      const value = recoveryQuote();
      const saved = result(
        asActor(
          `${prepare(value)} ${recoveryConfirm(value.id)} ${snapshot(value.id)}`
        )
      );
      expect(saved.address).not.toHaveProperty('postal_code');
      expect(saved.address).not.toHaveProperty('postalCode');
      expect(saved.address.address_line1).toBe(saved.address.address);
      expect(saved.original).toEqual(original);
    });

    it('persists an explicitly confirmed street including its original legacy unit', () => {
      const base = recoveryQuote();
      const street = `${original.address_line1}, ${original.address_line2}`;
      const value = {
        ...base,
        quote_request: {
          ...base.quote_request,
          receiver: { ...base.quote_request.receiver, address: street },
        },
      };
      const saved = result(
        asActor(
          `${prepare(value)} ${recoveryConfirm(value.id)} ${snapshot(value.id)}`
        )
      );
      expect(saved.address.address).toBe(street);
      expect(saved.address.address_line1).toBe(street);
      expect(saved.address).not.toHaveProperty('address_line2');
      expect(saved.original).toEqual(original);
      expect(saved).toMatchObject({
        funding: 'customer_checkout',
        fee: 110,
        retained: 110,
        unbooked: true,
        confirmed: 1,
      });
    });

    it('clears both old postcode aliases when a signed preview changes destination', () => {
      const base = recoveryQuote();
      const resolved = resolveRecoveryQuoteReceiver(
        { ...base.quote_request.receiver, address: '99 New Street' },
        original
      );
      if ('error' in resolved) throw new Error(resolved.error);
      const value = {
        ...base,
        quote_request: {
          ...base.quote_request,
          receiver: { ...base.quote_request.receiver, ...resolved.override },
        },
      };
      const saved = result(
        asActor(
          `${prepare(value)} ${recoveryConfirm(value.id)} ${snapshot(value.id)}`
        )
      );
      expect(saved.address.address).toBe('99 New Street');
      expect(saved.address.address_line1).toBe('99 New Street');
      expect(saved.address).not.toHaveProperty('postalCode');
      expect(saved.address).not.toHaveProperty('postal_code');
      expect(saved.original).toEqual(original);
      expect(saved).toMatchObject({
        funding: 'customer_checkout',
        fee: 110,
        retained: 110,
        unbooked: true,
        confirmed: 1,
      });
    });

    it('rolls back alias changes when the existing economics writer rejects confirmation', () => {
      const value = { ...recoveryQuote(), platform_margin: 11 };
      const saved = result(
        asActor(`${prepare(value)} DO $$ BEGIN
        PERFORM public.confirm_customer_checkout_shipping_recovery('${orderId}','${value.id}',true);
        EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END $$; ${snapshot(value.id)}`)
      );
      expect(saved.address).toEqual(original);
      expect(saved).toMatchObject({
        funding: 'customer_checkout',
        fee: 110,
        retained: 110,
        cost: 90,
        margin: 20,
        unbooked: true,
        confirmed: 0,
      });
    });
  }
);
