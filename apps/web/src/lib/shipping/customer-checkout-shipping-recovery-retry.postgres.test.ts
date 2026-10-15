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
  'committed checkout recovery confirmation retries',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase();
    beforeAll(() => database.start(), 60000);
    afterAll(() => database.stop());
    function actor(sql: string) {
      return database.query(`BEGIN; ${recoveryActorAuth()} ${sql} ROLLBACK;`);
    }
    function prepare() {
      const quote = recoveryQuote();
      const fingerprint = JSON.parse(
        actor(
          `SELECT public.get_customer_checkout_shipping_recovery_context('${orderId}');`
        )
          .trim()
          .split('\n')
          .at(-1) ?? '{}'
      ).fingerprint;
      const proof = createShippingQuoteRouteProof({
        action: 'prepare_customer_checkout_shipping_recovery',
        merchantId,
        subjectId: orderId,
        payload: { order_id: orderId, fingerprint, quote },
      });
      return { id: quote.id, sql: recoveryPrepare(quote, fingerprint, proof) };
    }
    const changes = [
      [
        'booked',
        "shipping_status='shipped',shipment_id='70000000-0000-4000-8000-000000000002',tracking_number='already-tracked'",
      ],
      ['cancelled', 'cancelled_at=now()'],
      ['refunded', "payment_status='refunded'"],
      [
        'booking reserved',
        "shipment_booking_lock_token='70000000-0000-4000-8000-000000000001'",
      ],
    ];
    it.each(
      changes
    )('acknowledges a saved preview after the order is %s without reapplying it', (_label, change) => {
      const preview = prepare();
      const output = actor(`${preview.sql} ${recoveryConfirm(preview.id)}
        RESET ROLE; UPDATE public.orders SET ${change},
          shipping_address='{"address":"Later authorized destination"}' WHERE id='${orderId}';
        UPDATE private.customer_checkout_shipping_recovery_previews SET
          expires_at=now()-interval '1 day',quote='{"redacted":true}',original_address='{}'
          WHERE id='${preview.id}';
        ${recoveryActorAuth()} ${recoveryConfirm(preview.id)}
        RESET ROLE; SELECT shipping_address->>'address',
          (SELECT count(*) FROM private.customer_checkout_shipping_recovery_previews WHERE confirmed_at IS NOT NULL)
          FROM public.orders WHERE id='${orderId}';`);
      expect(output.match(/"confirmed": true/g)).toHaveLength(2);
      expect(output.trim().split('\n').at(-1)).toBe(
        'Later authorized destination|1'
      );
    });
    it.each(
      changes
    )('still rejects the first confirmation after the order is %s', (_label, change) => {
      const preview = prepare();
      expect(() =>
        actor(`${preview.sql} RESET ROLE;
        UPDATE public.orders SET ${change} WHERE id='${orderId}';
        ${recoveryActorAuth()} ${recoveryConfirm(preview.id)}`)
      ).toThrow(/shipping_recovery_unavailable|order_refunded_for_shipment/);
    });
    it('requires the committed preview to remain the selected quote', () => {
      const preview = prepare();
      expect(() =>
        actor(`${preview.sql} ${recoveryConfirm(preview.id)}
        RESET ROLE; UPDATE public.orders SET selected_quote_id=NULL;
        ${recoveryActorAuth()} ${recoveryConfirm(preview.id)}`)
      ).toThrow(/shipping_recovery_stale/);
    });
    it('denies an actor who is no longer the merchant owner', () => {
      const preview = prepare();
      expect(() =>
        actor(`${preview.sql} ${recoveryConfirm(preview.id)}
        RESET ROLE; UPDATE public.merchants SET user_id='20000000-0000-4000-8000-000000000002';
        ${recoveryActorAuth()} ${recoveryConfirm(preview.id)}`)
      ).toThrow(/forbidden_shipping_recovery/);
    });
    it('denies a new owner who did not prepare the committed preview', () => {
      const preview = prepare();
      expect(() =>
        actor(`${preview.sql} ${recoveryConfirm(preview.id)}
        RESET ROLE; UPDATE public.merchants SET user_id='20000000-0000-4000-8000-000000000002';
        ${recoveryActorAuth('20000000-0000-4000-8000-000000000002')}
        ${recoveryConfirm(preview.id)}`)
      ).toThrow(/forbidden_shipping_recovery/);
    });
    it('still requires explicit destination confirmation on a retry', () => {
      const preview = prepare();
      expect(() =>
        actor(`${preview.sql} ${recoveryConfirm(preview.id)}
        SELECT public.confirm_customer_checkout_shipping_recovery('${orderId}','${preview.id}',false);`)
      ).toThrow(/destination_confirmation_required/);
    });

    it('acknowledges a separately committed confirmation after another session books the order', () => {
      const preview = prepare();
      database.query(`BEGIN; ${recoveryActorAuth()} ${preview.sql}
        ${recoveryConfirm(preview.id)} COMMIT;`);
      database.query(`BEGIN; UPDATE public.orders SET shipping_status='shipped',
        shipment_id='70000000-0000-4000-8000-000000000002',tracking_number='booked-later'
        WHERE id='${orderId}'; COMMIT;`);
      const snapshot = `SELECT pg_catalog.jsonb_build_object(
        'order',pg_catalog.to_jsonb(o),'preview',pg_catalog.to_jsonb(p))
        FROM public.orders o JOIN private.customer_checkout_shipping_recovery_previews p
          ON p.order_id=o.id WHERE p.id='${preview.id}';`;
      const before = database.query(snapshot);
      const retried = actor(recoveryConfirm(preview.id));
      expect(JSON.parse(retried.trim().split('\n').at(-1) ?? '{}')).toEqual({
        quoteId: preview.id,
        confirmed: true,
      });
      expect(database.query(snapshot)).toBe(before);
    });
  }
);
