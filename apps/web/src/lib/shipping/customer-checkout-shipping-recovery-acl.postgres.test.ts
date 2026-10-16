import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomerCheckoutShippingRecoveryTestDatabase } from '../../../../../supabase/tests/customer-checkout-shipping-recovery-test-harness.mjs';
import { recoveryActorAuth } from './customer-checkout-shipping-recovery.postgres.test-support';

describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'recovery RPC effective permissions after every migration',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase();
    beforeAll(() => database.start(), 60000);
    afterAll(() => database.stop());

    it('runs actor SQL as authenticated inside a transaction', () => {
      const result = database.query(`BEGIN; ${recoveryActorAuth()}
        SELECT current_user, rolsuper FROM pg_catalog.pg_roles
          WHERE rolname = current_user; ROLLBACK;`);
      expect(result.trim().split('\n').at(-1)).toBe('authenticated|f');
    });
    it('fails explicitly if a caller forgets the actor transaction', () => {
      expect(() => database.query(recoveryActorAuth())).toThrow(
        /recovery actor requires an authenticated transaction/
      );
    });

    it.each([
      'public.get_customer_checkout_shipping_recovery_context(uuid)',
      'public.prepare_customer_checkout_shipping_recovery(uuid,text,jsonb,jsonb)',
      'public.confirm_customer_checkout_shipping_recovery(uuid,uuid,boolean)',
    ])('grants only authenticated clients EXECUTE on %s', (signature) => {
      expect(
        database
          .query(`SELECT
          has_function_privilege('authenticated','${signature}','EXECUTE'),
          has_function_privilege('anon','${signature}','EXECUTE'),
          has_function_privilege('service_role','${signature}','EXECUTE');`)
          .trim()
      ).toBe('t|f|f');
    });

    it('indexes confirmed previews still awaiting redaction', () => {
      const result = database.query(`SELECT indexdef FROM pg_catalog.pg_indexes
        WHERE schemaname = 'private'
          AND indexname = 'checkout_shipping_recovery_pending_redaction_idx';`);
      expect(result).toContain('(confirmed_at)');
      expect(result).toContain('confirmed_at IS NOT NULL');
      expect(result).toContain('original_address <>');
      expect(result).toContain('quote <>');
    });
  }
);
