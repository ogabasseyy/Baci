import { describe, expect, it, vi } from 'vitest';
import {
  client,
  server,
  stage,
  termsDocument,
} from './customer-purchase-http.fixture';
import { goal, query } from './purchase-pricing-runtime.fixture';

vi.mock('server-only', () => ({}));
const restarted = process.env.PIGGYVEST_CUSTOMER_HTTP_RESTART === '1';
describe.skipIf(process.env.PIGGYVEST_RUN_CUSTOMER_PURCHASE_HTTP !== '1')(
  'actual local HTTP plus restricted driver purchase/lifecycle',
  () => {
    it.skipIf(restarted)(
      'publishes real pickup pricing, retains commit-loss reservation and recovers exact replay after price change',
      async () => {
        const running = await server(210, true);
        try {
          const call = await client(running.origin);
          const quoteResponse = await call('/purchase/quote', {
            goalId: goal(210),
            quoteId: goal(84210),
            shippingRateId: goal(8001),
            savingsKobo: 98000,
            fulfilmentMode: 'pickup',
          });
          expect(quoteResponse.status).toBe(200);
          const published = await quoteResponse.json();
          expect(published).toMatchObject({
            fulfilmentMode: 'pickup',
            quote: {
              currency: 'NGN',
              deviceKobo: 98000,
              deliveryKobo: 1500,
              taxKobo: 7350,
              feeKobo: 50,
            },
          });
          const command = {
            goalId: goal(210),
            operationId: goal(94210),
            accepted: true,
            fulfilmentMode: 'pickup',
            quote: published.quote,
          };
          const lost = await call('/purchase/prepare', command);
          expect(lost.status).toBe(503);
          expect(await lost.json()).toMatchObject({
            reservation: 'may_be_retained',
            operationId: goal(94210),
          });
          await query(
            'harness_admin',
            'UPDATE public.product_variants SET price_override=999'
          );
          const status = await call(
            `/purchase/status?goalId=${goal(210)}&operationId=${goal(94210)}`
          );
          expect(status.status).toBe(200);
          const { current, ...historical } = await status.json();
          expect(current).toMatchObject({
            reservation: 'retained',
            fundsUse: 'not_authorized',
          });
          expect(historical).toMatchObject({
            status: 'purchase_pending',
            fulfilment: 'disabled',
            dispatch: 'contract_gap',
          });
          const replay = await call('/purchase/prepare', command);
          expect(replay.status).toBe(200);
          expect(await replay.json()).toEqual(historical);
          expect(
            (
              await call('/purchase/prepare', {
                ...command,
                operationId: goal(95210),
              })
            ).status
          ).toBe(503);
          expect(
            (
              await query(
                'harness_admin',
                'SELECT count(*)::int AS count FROM piggyvest_purchase_preparation.intents WHERE goal_id=$1',
                [goal(210)]
              )
            ).rows[0].count
          ).toBe(1);
        } finally {
          await query(
            'harness_admin',
            'UPDATE public.product_variants SET price_override=980'
          );
          await running.close();
        }
      }
    );
    it.skipIf(restarted)(
      'requires versioned duration consent before funds and activates at exact ceil threshold',
      async () => {
        const revisionId = await stage(241);
        const running = await server(241);
        try {
          const call = await client(running.origin);
          const activation = {
            goalId: goal(241),
            revisionId,
            operationId: goal(94241),
          };
          expect((await call('/lifecycle/activate', activation)).status).toBe(
            503
          );
          expect(
            (
              await call('/lifecycle/terms', {
                goalId: goal(241),
                revisionId,
                durationMonths: 1,
              })
            ).status
          ).toBe(200);
          const review = await (
            await call(`/policy?goalId=${goal(241)}`)
          ).json();
          expect(review).toMatchObject({
            durationMonths: 1,
            consent: 'required',
            terms: termsDocument,
          });
          const acceptance = {
            goalId: goal(241),
            revisionId,
            termsVersion: termsDocument.version,
            termsHash: termsDocument.hash,
            accepted: true,
          };
          expect((await call('/policy', acceptance)).status).toBe(409);
          expect(
            (await call('/policy', { ...acceptance, durationMonths: 1 })).status
          ).toBe(200);
          await query(
            'piggyvest_staging_policy_writer',
            'SELECT goal_policy_test.purchase_credit(241,5000,942410)'
          );
          expect((await call('/lifecycle/activate', activation)).status).toBe(
            503
          );
          await query(
            'piggyvest_staging_policy_writer',
            'SELECT goal_policy_test.purchase_credit(241,1,942411)'
          );
          const response = await call('/lifecycle/activate', activation);
          expect(response.status).toBe(200);
          const receipt = await response.json();
          expect(receipt).toMatchObject({
            lifecycle: 'active',
            guaranteeKobo: 100001,
            durationMonths: 1,
            collectionPaused: true,
            collectionConsent: 'not_granted',
            evidence: 'local_synthetic_only',
          });
          expect(
            await (await call('/lifecycle/activate', activation)).json()
          ).toEqual(receipt);
        } finally {
          await running.close();
        }
      }
    );
    it.skipIf(restarted)(
      'does not activate an expired consented quote or change the guarantee',
      async () => {
        const revisionId = await stage(242, 3);
        const running = await server(242);
        try {
          const call = await client(running.origin);
          expect(
            (
              await call('/lifecycle/terms', {
                goalId: goal(242),
                revisionId,
                durationMonths: 1,
              })
            ).status
          ).toBe(200);
          expect(
            (
              await call('/policy', {
                goalId: goal(242),
                revisionId,
                termsVersion: termsDocument.version,
                termsHash: termsDocument.hash,
                accepted: true,
                durationMonths: 1,
              })
            ).status
          ).toBe(200);
          await query(
            'piggyvest_staging_policy_writer',
            'SELECT goal_policy_test.purchase_credit(242,5001,942420)'
          );
          for (let remaining = 3; remaining > 0; remaining--) {
            await query(
              'harness_admin',
              `SELECT pg_sleep(least(1,greatest(0,extract(epoch FROM ((command->>'quoteExpiresAt')::timestamptz-clock_timestamp()))))) FROM piggyvest_goal_policy.snapshots WHERE goal_id=$1`,
              [goal(242)]
            );
          }
          expect(
            (
              await call('/lifecycle/activate', {
                goalId: goal(242),
                revisionId,
                operationId: goal(94242),
              })
            ).status
          ).toBe(503);
          expect(
            (
              await query(
                'harness_admin',
                'SELECT count(*)::int AS count FROM piggyvest_goal_policy.lifecycle_activations WHERE goal_id=$1',
                [goal(242)]
              )
            ).rows[0].count
          ).toBe(0);
        } finally {
          await running.close();
        }
      }
    );
    it.skipIf(!restarted)(
      'recovers historical purchase status after PostgreSQL restart without settlement',
      async () => {
        const running = await server(210);
        try {
          const call = await client(running.origin);
          expect(
            await (
              await call(
                `/purchase/status?goalId=${goal(210)}&operationId=${goal(94210)}`
              )
            ).json()
          ).toMatchObject({
            status: 'purchase_pending',
            fulfilment: 'disabled',
          });
          expect(
            (
              await query(
                'harness_admin',
                "SELECT count(*)::int AS count FROM piggyvest_savings_ledger.operations WHERE command->>'kind' IN ('settle_reservation','release_purchase')"
              )
            ).rows[0].count
          ).toBe(0);
        } finally {
          await running.close();
        }
      }
    );
  }
);
