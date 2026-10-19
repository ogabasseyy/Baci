import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCustomerCheckoutShippingRecoveryTestDatabase } from '../../../../../supabase/tests/customer-checkout-shipping-recovery-test-harness.mjs';
import {
  RECOVERY_MERCHANT_ID,
  RECOVERY_ORDER_ID,
  recoveryActorAuth,
  recoveryConfirm,
  recoveryPrepare,
  recoveryQuote,
  recoveryWaitFor,
} from './customer-checkout-shipping-recovery.postgres.test-support';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

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

describe.skipIf(process.env.BACI_SHIPPING_QUOTE_POSTGRES !== '1')(
  'recovery production activation gate',
  () => {
    const database = createCustomerCheckoutShippingRecoveryTestDatabase({
      activateRecovery: false,
    });
    beforeAll(() => database.start(), 60000);
    afterAll(() => database.stop());
    const context = () =>
      database.query(
        `BEGIN; ${recoveryActorAuth()} SELECT public.get_customer_checkout_shipping_recovery_context('${RECOVERY_ORDER_ID}'); ROLLBACK;`
      );

    it('blocks recovery by default before a compatible rollback artifact is recorded', () => {
      expect(context).toThrow('shipping_recovery_not_activated');
    });
    it('blocks direct preparation independently of the web API', () => {
      expect(() =>
        database.query(
          `BEGIN; ${recoveryActorAuth()} SELECT public.prepare_customer_checkout_shipping_recovery('${RECOVERY_ORDER_ID}',repeat('a',64),'{}','{}'); ROLLBACK;`
        )
      ).toThrow('shipping_recovery_not_activated');
    });
    it('denies callers access to activation state', () => {
      expect(() =>
        database.query(
          `BEGIN; ${recoveryActorAuth()} UPDATE private.checkout_shipping_recovery_release_activation SET enabled=true; ROLLBACK;`
        )
      ).toThrow(/permission denied/);
    });
    it('keeps clients denied if a later grant and permissive policy are added', () => {
      const result = database.query(`BEGIN;
        GRANT USAGE ON SCHEMA private TO authenticated;
        GRANT SELECT, UPDATE ON private.checkout_shipping_recovery_release_activation TO authenticated;
        CREATE POLICY synthetic_future_allow ON private.checkout_shipping_recovery_release_activation
          TO authenticated USING (true) WITH CHECK (true);
        ${recoveryActorAuth()}
        SELECT count(*) FROM private.checkout_shipping_recovery_release_activation;
        WITH changed AS (
          UPDATE private.checkout_shipping_recovery_release_activation SET enabled=false RETURNING singleton
        ) SELECT count(*) FROM changed;
        ROLLBACK;`);
      expect(result.trim().split('\n').slice(-2)).toEqual(['0', '0']);
    });
    it('refuses activation without artifact evidence or with the known incompatible commit', () => {
      expect(() =>
        database.query(
          'UPDATE private.checkout_shipping_recovery_release_activation SET enabled=true;'
        )
      ).toThrow(/check constraint/);
      expect(() =>
        database.query(
          `UPDATE private.checkout_shipping_recovery_release_activation SET enabled=true, rollback_deployment_id='dpl_synthetic', rollback_commit_sha='32e893bf99bb8060e55e7440d3288418efa43189', verified_at=now();`
        )
      ).toThrow(/check constraint/);
    });
    it('blocks first confirmation while closed but preserves a confirmed retry', () => {
      // Derive fixture timestamps from the isolated database clock. Host/VM
      // clock skew must not turn this activation test into an expiry test.
      const clock: { issued: string; expires: string } = JSON.parse(
        database
          .query(
            `SELECT json_build_object('issued',now(),'expires',now()+interval '1 hour');`
          )
          .trim()
      );
      const value = { ...recoveryQuote(), expires_at: clock.expires };
      database.query(`UPDATE private.checkout_shipping_recovery_release_activation
        SET enabled=true, rollback_deployment_id='dpl_syntheticCompatible',
          rollback_commit_sha='8c8df7846777f714cfb573c44eb215059e09b7d4', verified_at=now();`);
      const hash =
        database
          .query(`BEGIN; ${recoveryActorAuth()}
        SELECT public.get_customer_checkout_shipping_recovery_context('${RECOVERY_ORDER_ID}')->>'fingerprint'; ROLLBACK;`)
          .trim()
          .split('\n')
          .at(-1) ?? '';
      const signed = createShippingQuoteRouteProof({
        now: clock.issued,
        action: 'prepare_customer_checkout_shipping_recovery',
        merchantId: RECOVERY_MERCHANT_ID,
        subjectId: RECOVERY_ORDER_ID,
        payload: {
          order_id: RECOVERY_ORDER_ID,
          fingerprint: hash,
          quote: value,
        },
      });
      database.query(
        `BEGIN; ${recoveryActorAuth()} ${recoveryPrepare(value, hash, signed)} COMMIT;`
      );
      database.query(
        'UPDATE private.checkout_shipping_recovery_release_activation SET enabled=false;'
      );
      expect(() =>
        database.query(
          `BEGIN; ${recoveryActorAuth()} ${recoveryConfirm(value.id)} COMMIT;`
        )
      ).toThrow('shipping_recovery_not_activated');
      expect(
        database
          .query(
            `SELECT selected_quote_id IS NULL FROM public.orders WHERE id='${RECOVERY_ORDER_ID}';`
          )
          .trim()
      ).toBe('t');
      // Keep the successful confirmation and its retry inside a rolled-back
      // test transaction, so subsequent tests retain the original order.
      const output = database.query(`BEGIN;
        UPDATE private.checkout_shipping_recovery_release_activation SET enabled=true;
        ${recoveryActorAuth()} ${recoveryConfirm(value.id)} RESET ROLE;
        UPDATE private.checkout_shipping_recovery_release_activation SET enabled=false;
        SET LOCAL ROLE authenticated; ${recoveryConfirm(value.id)} RESET ROLE;
        SELECT count(*) FROM public.shipping_quote_attestations WHERE quote_id='${value.id}'; ROLLBACK;`);
      expect(output.match(/"confirmed": true/g)?.length).toBe(2);
      expect(output.trim().split('\n').at(-1)).toBe('1');
    });
    it('waits for an in-flight recovery transaction before disabling', async () => {
      database.query(
        `UPDATE private.checkout_shipping_recovery_release_activation SET enabled=true, rollback_deployment_id='dpl_syntheticCompatible', rollback_commit_sha='8c8df7846777f714cfb573c44eb215059e09b7d4', verified_at=now();`
      );
      const holder = database.queryAsync(`BEGIN; ${recoveryActorAuth()}
        SELECT public.get_customer_checkout_shipping_recovery_context('${RECOVERY_ORDER_ID}');
        SELECT pg_sleep(8); COMMIT;`);
      await recoveryWaitFor(
        () =>
          database
            .query(`SELECT EXISTS(SELECT 1 FROM pg_locks
        WHERE relation='private.checkout_shipping_recovery_release_activation'::regclass
          AND mode='RowShareLock' AND granted);`)
            .trim() === 't',
        'activation share lock'
      );
      const disable =
        database.queryAsync(`SET application_name='recovery_gate_disabler';
        UPDATE private.checkout_shipping_recovery_release_activation SET enabled=false RETURNING enabled;`);
      await recoveryWaitFor(
        () =>
          database
            .query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE application_name='recovery_gate_disabler' AND wait_event_type='Lock');`)
            .trim() === 't',
        'activation disabler lock wait'
      );
      await holder;
      expect((await disable).trim()).toBe('f');
      expect(context).toThrow('shipping_recovery_not_activated');
    }, 30000);
    it('lets disable proceed while recovery is waiting for the order lock', async () => {
      database.query(`UPDATE private.checkout_shipping_recovery_release_activation
        SET enabled=true, rollback_deployment_id='dpl_syntheticCompatible',
          rollback_commit_sha='8c8df7846777f714cfb573c44eb215059e09b7d4', verified_at=now();`);
      const holder = database.queryAsync(`BEGIN;
        SET application_name='recovery_order_lock_holder';
        SELECT pg_advisory_xact_lock(hashtextextended('baci_order_payment:${RECOVERY_ORDER_ID}',0));
        SELECT pg_sleep(8); COMMIT;`);
      await recoveryWaitFor(
        () =>
          database
            .query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE application_name='recovery_order_lock_holder' AND wait_event='PgSleep');`)
            .trim() === 't',
        'held order advisory lock'
      );
      const waiting = database
        .queryAsync(`BEGIN; SET application_name='recovery_waiting_context';
        ${recoveryActorAuth()} SELECT public.get_customer_checkout_shipping_recovery_context('${RECOVERY_ORDER_ID}'); ROLLBACK;`)
        .then(
          (output) => ({ output, error: '' }),
          (error: Error) => ({ output: '', error: error.message })
        );
      try {
        await recoveryWaitFor(
          () =>
            database
              .query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE application_name='recovery_waiting_context' AND wait_event='advisory');`)
              .trim() === 't',
          'context waiting for order'
        );
        // A request that has not crossed the order boundary must not hold
        // activation open. A timeout makes the old lock order fail explicitly.
        database.query(`BEGIN; SET LOCAL lock_timeout='500ms';
          UPDATE private.checkout_shipping_recovery_release_activation SET enabled=false; COMMIT;`);
      } finally {
        await holder;
      }
      expect((await waiting).error).toContain(
        'shipping_recovery_not_activated'
      );
      expect(context).toThrow('shipping_recovery_not_activated');
    }, 30000);
    it('allows verified activation and disables new recovery again without changing orders', () => {
      database.query(
        `UPDATE private.checkout_shipping_recovery_release_activation SET enabled=true, rollback_deployment_id='dpl_syntheticCompatible', rollback_commit_sha='8c8df7846777f714cfb573c44eb215059e09b7d4', verified_at=now();`
      );
      expect(context()).toContain(RECOVERY_ORDER_ID);
      database.query(
        'UPDATE private.checkout_shipping_recovery_release_activation SET enabled=false;'
      );
      expect(context).toThrow('shipping_recovery_not_activated');
      expect(
        database
          .query(
            `SELECT shipping_funding_source,shipping_fee FROM public.orders WHERE id='${RECOVERY_ORDER_ID}';`
          )
          .trim()
      ).toBe('customer_checkout|110');
    });
  }
);
