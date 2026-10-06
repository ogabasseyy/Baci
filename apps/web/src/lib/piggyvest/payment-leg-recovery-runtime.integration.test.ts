// @vitest-environment node

import { piggyvestPurchaseSchemas } from '@baci/shared/contracts';
import { AuthError } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestCustomerPurchaseHandler } from './customer-purchase-handler';
import { termsDocument } from './customer-purchase-http.fixture';
import { createPaymentLegRecovery } from './payment-leg-recovery';
import { PAYMENT_LEG_RECOVERY_STATEMENTS as statements } from './payment-leg-recovery-statements';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';
import {
  actorId,
  authenticatedReader,
  configuration,
  customerId,
  database,
  goal,
  merchantId,
  query,
} from './purchase-pricing-runtime.fixture';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';

vi.mock('server-only', () => ({}));
describe.skipIf(process.env.PIGGYVEST_RUN_PAYMENT_LEG_RECOVERY !== '1')(
  '183 actual restricted executor and persisted purchase recovery',
  () => {
    const config = () => ({
      environment: 'staging',
      transport: 'local_test',
      enabled: true,
      integrationId: configuration().integrationId,
      merchantId,
      customerId,
      goalId: goal(201),
      expectedBusinessId: 'synthetic-business',
      actorId,
    });
    const store = () =>
      createPaymentLegRecovery({
        configuration: config(),
        execute: createPiggyvestPostgresExecutor(database()),
      });
    it('requires the real registered exact statements and rejects another role before access', async () => {
      for (const entry of Object.values(statements)) {
        expect(Object.values(PIGGYVEST_POSTGRES_STATEMENTS)).toContainEqual(
          entry
        );
        const execute = createPiggyvestPostgresExecutor({
          ...database(),
          role: 'piggyvest_staging_ledger_worker',
        });
        await expect(
          execute(entry.text, [
            config().integrationId,
            merchantId,
            customerId,
            goal(201),
            'synthetic-business',
            actorId,
            goal(4201),
            null,
          ])
        ).rejects.toThrow();
      }
    });
    it('retains logical references and amounts across process restart, not synthetic payment success', async () => {
      const result = await store().read({
        operationId: goal(4201),
        observationId: goal(183001),
      });
      expect(result).toMatchObject({
        status: 'purchase_pending',
        savingsKobo: 97000,
        otherPaymentKobo: 2150,
        fulfilment: 'disabled',
        current: { reservation: 'retained', fundsUse: 'not_authorized' },
        paymentLegRecovery: {
          completion: 'metadata_only',
          financialEffects: 'UNKNOWN',
          retry: 'not_authorized',
          historicalObservation: {
            observationId: goal(183001),
            reason: 'outcome_unconfirmed',
          },
          legs: [
            {
              operationId: goal(4201),
              leg: 'savings',
              referenceType: 'local_intent_leg',
              amountKobo: 97000,
              providerReference: null,
              outcome: 'unknown',
            },
            {
              operationId: goal(4201),
              leg: 'other',
              amountKobo: 2150,
              outcome: 'unknown',
            },
          ],
        },
      });
    });
    it('survives committed response loss and exact replay while rejecting global conflicts', async () => {
      const command = {
        operationId: goal(4201),
        observationId: goal(183101),
        leg: 'savings',
        reason: 'reference_unverified',
      };
      const execute = createPiggyvestPostgresExecutor(database());
      if (process.env.PIGGYVEST_PAYMENT_LEG_RESTART !== '1') {
        const lose = createPaymentLegRecovery({
          configuration: config(),
          execute: async (text, parameters) => {
            await execute(text, parameters);
            throw new Error('Synthetic lost ACK');
          },
        });
        expect(await lose.observe(command)).toMatchObject({
          status: 'unavailable',
        });
      }
      const result = await store().observe(command);
      expect(result).toMatchObject({
        status: 'purchase_pending',
        paymentLegRecovery: {
          historicalObservation: { observationId: goal(183101) },
        },
      });
      expect(
        await store().observe({ ...command, reason: 'compensation_unresolved' })
      ).toMatchObject({ status: 'unavailable' });
      expect(
        (
          await query(
            'harness_admin',
            'SELECT count(*)::int AS count FROM piggyvest_purchase_preparation.payment_leg_observations WHERE id=$1',
            [goal(183101)]
          )
        ).rows
      ).toEqual([{ count: 1 }]);
    });
    it('serializes simultaneous same and conflicting observation IDs without new legs or ledger writes', async () => {
      const command = {
        operationId: goal(4201),
        observationId: goal(183102),
        leg: 'savings',
        reason: 'outcome_unconfirmed',
      };
      const results = await Promise.all([
        store().observe(command),
        store().observe(command),
      ]);
      expect(
        results.every((result) => result.status === 'purchase_pending')
      ).toBe(true);
      const conflict = { ...command, observationId: goal(183103) };
      if (process.env.PIGGYVEST_PAYMENT_LEG_RESTART !== '1') {
        const competing = await Promise.all([
          store().observe(conflict),
          store().observe({ ...conflict, leg: 'other' }),
        ]);
        expect(
          competing.filter((result) => result.status === 'purchase_pending')
        ).toHaveLength(1);
        expect(
          competing.filter((result) => result.status === 'unavailable')
        ).toHaveLength(1);
      }
      expect(
        (
          await query(
            'harness_admin',
            'SELECT count(*)::int AS count FROM piggyvest_purchase_preparation.payment_leg_observations WHERE id=$1',
            [goal(183102)]
          )
        ).rows
      ).toEqual([{ count: 1 }]);
    });
    it('composes authenticated scoped GET status with strict public DTO and no private fields; absent feature remains compatible', async () => {
      const options = {
        supabase: authenticatedReader(),
        configuration: configuration(),
        goalId: goal(201),
        execute: createPiggyvestPostgresExecutor(database()),
        checkCsrfProtection: vi.fn(),
      };
      const request = () =>
        new NextRequest(
          `http://localhost/purchase/status?goalId=${goal(201)}&operationId=${goal(4201)}`
        );
      const enabled = createPiggyvestCustomerPurchaseHandler({
        ...options,
        paymentLegRecovery: { enabled: true },
      });
      const response = await enabled.status(request());
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = piggyvestPurchaseSchemas.status.parse(await response.json());
      expect(body.paymentLegRecovery?.financialEffects).toBe('UNKNOWN');
      expect(JSON.stringify(body)).not.toContain(actorId);
      const legacy = await createPiggyvestCustomerPurchaseHandler(
        options
      ).status(request());
      expect(
        piggyvestPurchaseSchemas.status.parse(await legacy.json())
          .paymentLegRecovery
      ).toBeUndefined();
      const foreign = createPiggyvestCustomerPurchaseHandler({
        ...options,
        supabase: authenticatedReader(goal(999)),
        paymentLegRecovery: { enabled: true },
      });
      expect((await foreign.status(request())).status).toBe(403);
      expect(options.checkCsrfProtection).not.toHaveBeenCalled();
    });
    it('serves actual HTTP enabled and disabled status without unauthenticated read or automatic writes', async () => {
      for (const enabled of [false, true]) {
        const running = await startPiggyvestRuntimeCompositionServer({
          port: 0,
          configuration: {
            mode: 'local_test',
            goalId: goal(201),
            context: configuration(),
            termsDocument,
          },
          services: {
            purchase: {
              enabled: true,
              ...(enabled ? { paymentLegRecovery: { enabled: true } } : {}),
            },
          },
          createRlsClient: async (request) => {
            const reader = authenticatedReader();
            if (request.headers.get('cookie') !== 'synthetic-session=owner')
              reader.auth.getUser = async () => ({
                data: { user: null },
                error: new AuthError('Synthetic unauthenticated', 401),
              });
            return reader;
          },
          execute: createPiggyvestPostgresExecutor(database()),
        });
        try {
          const url = `${running.origin}/purchase/status?goalId=${goal(201)}&operationId=${goal(4201)}`;
          expect((await fetch(url)).status).toBe(401);
          const response = await fetch(url, {
            headers: { cookie: 'synthetic-session=owner' },
          });
          expect(response.status).toBe(200);
          const body = piggyvestPurchaseSchemas.status.parse(
            await response.json()
          );
          expect(Boolean(body.paymentLegRecovery)).toBe(enabled);
          expect(body.current.reservation).toBe('retained');
        } finally {
          await running.close();
        }
      }
    });
  }
);
