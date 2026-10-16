import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomerCheckoutShippingRecoveryTestDatabase } from '../../../../../supabase/tests/customer-checkout-shipping-recovery-test-harness.mjs';
import {
  RECOVERY_MERCHANT_ID,
  RECOVERY_ORDER_ID,
} from './customer-checkout-shipping-recovery.postgres.test-support';

const enable = `UPDATE private.checkout_shipping_recovery_release_activation
  SET enabled=true, rollback_deployment_id='dpl_syntheticCompatible',
  rollback_commit_sha='8c8df7846777f714cfb573c44eb215059e09b7d4', verified_at=now();`;
const close =
  'UPDATE private.checkout_shipping_recovery_release_activation SET enabled=false;';
const insert = `INSERT INTO private.customer_checkout_shipping_recovery_previews
  (id,order_id,merchant_id,actor_id,fingerprint,original_address,quote,expires_at)
  SELECT '33333333-3333-4333-8333-333333333333','${RECOVERY_ORDER_ID}',id,user_id,
    repeat('a',64),'{"synthetic":true}','{}',now()+interval '1 hour'
  FROM public.merchants WHERE id='${RECOVERY_MERCHANT_ID}';`;

describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'legacy recovery writer backstop',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase({
      activateRecovery: false,
    });
    beforeAll(() => database.start(), 60000);
    afterAll(() => database.stop());

    it('rolls back order writes when an older writer tries to insert a preview while closed', () => {
      const original = database.query(
        `SELECT shipping_address::text FROM public.orders WHERE id='${RECOVERY_ORDER_ID}';`
      );
      expect(() =>
        database.query(`BEGIN;
      UPDATE public.orders SET shipping_address='{"synthetic":true}' WHERE id='${RECOVERY_ORDER_ID}';
      ${insert} COMMIT;`)
      ).toThrow('shipping_recovery_not_activated');
      expect(
        database.query(
          `SELECT shipping_address::text FROM public.orders WHERE id='${RECOVERY_ORDER_ID}';`
        )
      ).toBe(original);
    });
    it('blocks an older confirmation writer after the gate is closed', () => {
      expect(() =>
        database.query(`BEGIN; ${enable} ${insert} ${close}
      UPDATE private.customer_checkout_shipping_recovery_previews SET confirmed_at=now(); COMMIT;`)
      ).toThrow('shipping_recovery_not_activated');
    });
    it('keeps confirmed audit redaction available while recovery is closed', () => {
      const result = database.query(`BEGIN; ${enable} ${insert}
      UPDATE private.customer_checkout_shipping_recovery_previews SET confirmed_at=now()-interval '100 days';
      ${close}
      SELECT public.cleanup_customer_checkout_shipping_recovery_previews(1000,interval '1 day',interval '90 days');
      SELECT original_address='{}'::jsonb AND quote='{"redacted":true}'::jsonb
        FROM private.customer_checkout_shipping_recovery_previews;
      ROLLBACK;`);
      expect(result.trim().split('\n').at(-1)).toBe('t');
    });
    it('does not grant clients direct execution of the trigger function', () => {
      expect(
        database
          .query(`SELECT has_function_privilege('anon','private.enforce_checkout_shipping_recovery_activation()','EXECUTE'),
      has_function_privilege('authenticated','private.enforce_checkout_shipping_recovery_activation()','EXECUTE'),
      has_function_privilege('service_role','private.enforce_checkout_shipping_recovery_activation()','EXECUTE');`)
          .trim()
      ).toBe('f|f|f');
    });
  }
);
