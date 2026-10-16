import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCustomerCheckoutShippingRecoveryTestDatabase } from '../../../../../supabase/tests/customer-checkout-shipping-recovery-test-harness.mjs';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import {
  RECOVERY_MERCHANT_ID,
  RECOVERY_ORDER_ID,
  RECOVERY_OWNER_ID,
  recoveryActorAuth,
  recoveryConfirm,
  recoveryPrepare,
  recoveryQuote,
  recoveryWaitFor,
} from './customer-checkout-shipping-recovery.postgres.test-support';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'checkout shipping recovery PostgreSQL concurrency',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase({
      beforeFix: process.env.BACI_SHIPPING_RECOVERY_BEFORE_FIX === '1',
    });
    beforeAll(async () => database.start(), 60000);
    afterAll(() => database.stop());
    function fingerprint() {
      return (
        database
          .query(
            `BEGIN; ${recoveryActorAuth()} SELECT public.get_customer_checkout_shipping_recovery_context('${RECOVERY_ORDER_ID}')->>'fingerprint'; ROLLBACK;`
          )
          .trim()
          .split('\n')
          .at(-1) ?? ''
      );
    }
    function prepareStep(
      value = recoveryQuote(),
      hash = fingerprint(),
      signed = createShippingQuoteRouteProof({
        action: 'prepare_customer_checkout_shipping_recovery',
        merchantId: RECOVERY_MERCHANT_ID,
        subjectId: RECOVERY_ORDER_ID,
        payload: {
          order_id: RECOVERY_ORDER_ID,
          fingerprint: hash,
          quote: value,
        },
      })
    ) {
      return recoveryPrepare(value, hash, signed);
    }
    it('serializes simultaneous confirmations into one quote and one audit record', async () => {
      const value = recoveryQuote();
      const auth = `SELECT set_config('request.jwt.claim.role','authenticated',true);
        SELECT set_config('request.jwt.claim.sub','${RECOVERY_OWNER_ID}',true); SET LOCAL ROLE authenticated;`;
      database.query(`BEGIN; ${auth} ${prepareStep(value)} COMMIT;`);
      const results = await Promise.all([
        database.queryAsync(
          `BEGIN; ${auth} ${recoveryConfirm(value.id)} SELECT pg_sleep(0.15); COMMIT;`
        ),
        database.queryAsync(
          `BEGIN; ${auth} ${recoveryConfirm(value.id)} COMMIT;`
        ),
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
      const value = recoveryQuote();
      const auth = `SELECT set_config('request.jwt.claim.role','authenticated',true);
        SELECT set_config('request.jwt.claim.sub','${RECOVERY_OWNER_ID}',true); SET LOCAL ROLE authenticated;`;
      database.query(`BEGIN; ${auth} ${prepareStep(value)} COMMIT;`);
      const confirmer = database.queryAsync(`BEGIN; ${auth}
        SELECT public.get_customer_checkout_shipping_recovery_context('${RECOVERY_ORDER_ID}');
        SELECT public.confirm_customer_checkout_shipping_recovery('${RECOVERY_ORDER_ID}','${value.id}',true);
        SELECT pg_sleep(1); COMMIT;`);
      // Observe the relation lock before starting the editor: a condition
      // wait with a robust timeout replaces the fixed short delay, so a slow
      // CI host fails explicitly instead of silently observing unlocked.
      let locked = false;
      await recoveryWaitFor(() => {
        locked =
          database
            .query(`SELECT EXISTS(SELECT 1 FROM pg_locks
          WHERE relation='public.products'::regclass AND mode='RowShareLock' AND granted);`)
            .trim() === 't';
        return locked;
      }, 'products RowShareLock');
      const editor =
        database.queryAsync(`SET application_name='recovery_product_editor';
        UPDATE public.products SET weight_value=2 RETURNING weight_value;`);
      let blocked = false;
      await recoveryWaitFor(() => {
        blocked =
          database
            .query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE application_name='recovery_product_editor' AND wait_event_type='Lock');`)
            .trim() === 't';
        return blocked;
      }, 'product editor lock wait');
      const results = await Promise.all([confirmer, editor]);
      expect(locked).toBe(true);
      expect(blocked).toBe(true);
      expect(results[0]).toContain('"confirmed": true');
      expect(results[1].trim()).toBe('2');
    });
  }
);
