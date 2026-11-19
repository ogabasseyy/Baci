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

      // Hold a test-only advisory lock so the confirmer cannot commit until
      // we have observed the editor waiting on its actual product lock.
      const holder =
        database.queryAsync(`SET application_name='recovery_test_gate';
        SELECT pg_advisory_lock(74123, 1); SELECT pg_sleep(29);`);
      let confirmer: Promise<string> | undefined;
      let editor: Promise<string> | undefined;
      let backgroundError: unknown;
      let released = false;
      let primaryError: unknown;
      let cleanupError: unknown;
      void holder.catch((error: unknown) => {
        if (!released) backgroundError = error;
      });
      const deadline = Date.now() + 20000;
      const waitFor = async (probe: () => boolean, description: string) => {
        await recoveryWaitFor(
          () => {
            if (backgroundError) throw backgroundError;
            return probe();
          },
          description,
          Math.max(1, deadline - Date.now())
        );
      };
      try {
        await waitFor(
          () =>
            database
              .query(`SELECT EXISTS(SELECT 1 FROM pg_locks l
              JOIN pg_stat_activity a ON a.pid=l.pid
              WHERE a.application_name='recovery_test_gate'
                AND l.locktype='advisory' AND l.classid=74123
                AND l.objid=1 AND l.objsubid=2 AND l.granted);`)
              .trim() === 't',
          'test advisory gate'
        );
        confirmer =
          database.queryAsync(`SET application_name='recovery_test_confirmer';
          BEGIN; ${auth}
          SELECT public.get_customer_checkout_shipping_recovery_context('${RECOVERY_ORDER_ID}');
          SELECT public.confirm_customer_checkout_shipping_recovery('${RECOVERY_ORDER_ID}','${value.id}',true);
          SELECT pg_advisory_xact_lock(74123, 1); COMMIT;`);
        void confirmer.catch((error: unknown) => {
          backgroundError = error;
        });
        await waitFor(
          () =>
            database
              .query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a
              JOIN pg_locks p ON p.pid=a.pid
              JOIN pg_locks g ON g.pid=a.pid
              WHERE a.application_name='recovery_test_confirmer'
                AND p.relation='public.products'::regclass
                AND p.mode='RowShareLock' AND p.granted
                AND g.locktype='advisory' AND g.classid=74123
                AND g.objid=1 AND g.objsubid=2 AND NOT g.granted);`)
              .trim() === 't',
          'confirmed transaction holding product lock'
        );
        editor =
          database.queryAsync(`SET application_name='recovery_product_editor';
          UPDATE public.products SET weight_value=2 RETURNING weight_value;`);
        void editor.catch((error: unknown) => {
          backgroundError = error;
        });
        await waitFor(
          () =>
            database
              .query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity editor
              JOIN pg_stat_activity confirmer ON confirmer.application_name='recovery_test_confirmer'
              WHERE editor.application_name='recovery_product_editor'
                AND confirmer.pid = ANY(pg_blocking_pids(editor.pid)));`)
              .trim() === 't',
          'product editor blocked by confirmer'
        );
        const release = database
          .query(`SELECT COALESCE(bool_or(pg_terminate_backend(pid)), false)
          FROM pg_stat_activity WHERE application_name='recovery_test_gate' AND pid <> pg_backend_pid();`)
          .trim();
        expect(release).toBe('t');
        released = true;
        const results = await Promise.all([confirmer, editor]);
        expect(results[0]).toContain('"confirmed": true');
        expect(results[1].trim()).toBe('2');
      } catch (error) {
        primaryError = error;
      } finally {
        try {
          if (!released) {
            const stopped = database
              .query(`SELECT COALESCE(bool_and(pg_terminate_backend(pid)), true)
              FROM pg_stat_activity WHERE application_name='recovery_test_gate' AND pid <> pg_backend_pid();`)
              .trim();
            if (stopped !== 't')
              cleanupError = new Error('could not stop test gate');
          }
        } catch (error) {
          cleanupError = error;
        }
        await Promise.allSettled([
          holder,
          ...(confirmer ? [confirmer] : []),
          ...(editor ? [editor] : []),
        ]);
      }
      if (primaryError && cleanupError)
        throw new AggregateError(
          [primaryError, cleanupError],
          'test and cleanup failed'
        );
      if (primaryError) throw primaryError;
      if (cleanupError) throw cleanupError;
    }, 45000);
  }
);
