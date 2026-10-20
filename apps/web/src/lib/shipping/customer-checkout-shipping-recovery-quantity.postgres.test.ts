import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomerCheckoutShippingRecoveryTestDatabase } from '../../../../../supabase/tests/customer-checkout-shipping-recovery-test-harness.mjs';
import {
  RECOVERY_ORDER_ID,
  recoveryActorAuth,
} from './customer-checkout-shipping-recovery.postgres.test-support';
import { survivingShipmentQuantity } from './surviving-shipment-quantity';

describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'recovery context and booking quantity parity',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase();
    beforeAll(() => database.start(), 60000);
    afterAll(() => database.stop());
    it.each([
      '{}',
      '{"fulfillmentQuantity":"1"}',
      '{"fulfillmentQuantity":1.0}',
      '{"fulfillmentQuantity":0}',
      '{"fulfillmentQuantity":1.5}',
      '{"fulfillmentQuantity":-1}',
      '{"fulfillmentQuantity":null}',
      '{"fulfillmentQuantity":1000000000}',
      '{"fulfillmentQuantity":true}',
    ])('matches booking for %s', (payload) => {
      const output = database.query(`BEGIN;
        UPDATE public.order_items SET quantity=2, fulfillment_data='${payload}'::jsonb;
        ${recoveryActorAuth()}
        SELECT public.get_customer_checkout_shipping_recovery_context('${RECOVERY_ORDER_ID}')
          ->'order'->'order_items'->0->>'fulfillment_quantity'; ROLLBACK;`);
      expect(Number(output.trim().split('\n').at(-1))).toBe(
        survivingShipmentQuantity({
          quantity: 2,
          fulfillment_data: JSON.parse(payload),
        })
      );
    });
  }
);
