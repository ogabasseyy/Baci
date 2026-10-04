import { describe, expect, it, vi } from 'vitest';
import { purchasePreparationSchemas } from '@/schemas/purchase-preparation';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';
import { createPurchasePreparation } from './purchase-preparation';
import { PURCHASE_PREPARATION_STATEMENTS } from './purchase-preparation-statements';

vi.mock('server-only', () => ({}));
const goal = (sequence: number) =>
  `30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
const actorId = '90000000-0000-4000-8000-000000000001';
function database(role = 'piggyvest_staging_policy_writer') {
  return {
    environment: 'staging',
    transport: 'local_test',
    socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
    database: 'piggyvest_local',
    password: 'synthetic-local-only',
    role,
    port: 55449,
  };
}
function configuration(sequence: number, actor = actorId) {
  return {
    environment: 'staging',
    transport: 'local_test',
    integrationId: '40000000-0000-4000-8000-000000000001',
    merchantId: '10000000-0000-4000-8000-000000000001',
    customerId: '20000000-0000-4000-8000-000000000001',
    goalId: goal(sequence),
    expectedBusinessId: 'synthetic-business',
    actorId: actor,
  };
}
describe.skipIf(process.env.PIGGYVEST_RUN_PURCHASE_PREPARATION_RUNTIME !== '1')(
  'purchase adapter with actual restricted executor and local PostgreSQL',
  () => {
    it('requires the parent-approved exact three-operation catalog', () => {
      for (const operation of Object.values(PURCHASE_PREPARATION_STATEMENTS)) {
        expect(Object.values(PIGGYVEST_POSTGRES_STATEMENTS)).toContainEqual(
          operation
        );
      }
    });
    it('quotes, commits despite simulated response loss, reads status and replays the exact command', async () => {
      const execute = createPiggyvestPostgresExecutor(database());
      const runtime = createPurchasePreparation({
        configuration: configuration(207),
        execute,
      });
      const quote = purchasePreparationSchemas.quote.parse(
        await runtime.quote({ quoteId: goal(207) })
      );
      expect(quote).toMatchObject({
        currency: 'NGN',
        quantity: 1,
        deviceKobo: 96000,
        deliveryKobo: 2000,
        taxKobo: 100,
        feeKobo: 50,
        totalKobo: 98150,
        savingsKobo: 97000,
        otherPaymentKobo: 1150,
        principalKobo: 95000,
        paidInterestKobo: 2000,
        surplusKobo: 1000,
      });
      const command = { operationId: goal(4207), accepted: true, quote };
      const responseLost = createPurchasePreparation({
        configuration: configuration(207),
        execute: async (statement, parameters) => {
          await execute(statement, parameters);
          throw new Error('Synthetic loss after actual committed result');
        },
      });
      expect(await responseLost.prepare(command)).toEqual({
        status: 'unavailable',
        reservation: 'may_be_retained',
        dispatch: 'contract_gap',
      });
      const receipt = await runtime.status({
        operationId: command.operationId,
      });
      expect(receipt).toMatchObject({
        status: 'purchase_pending',
        operationId: command.operationId,
        savingsKobo: 97000,
        otherPaymentKobo: 1150,
        dispatch: 'contract_gap',
        fulfilment: 'disabled',
      });
      expect(await runtime.quote({ quoteId: goal(207) })).toEqual({
        status: 'unavailable',
      });
      expect(await runtime.prepare(command)).toEqual(receipt);
      expect(await runtime.prepare(command)).toEqual(receipt);
      expect(
        await runtime.prepare({
          ...command,
          quote: { ...quote, surplusKobo: 0 },
        })
      ).toMatchObject({ reservation: 'may_be_retained' });
      expect(
        await runtime.status({ operationId: command.operationId })
      ).toEqual(receipt);
    });
    it('rejects stale totals transactionally without creating a reservation', async () => {
      const runtime = createPurchasePreparation({
        configuration: configuration(208),
        execute: createPiggyvestPostgresExecutor(database()),
      });
      const quote = purchasePreparationSchemas.quote.parse(
        await runtime.quote({ quoteId: goal(208) })
      );
      expect(
        await runtime.prepare({
          operationId: goal(4208),
          accepted: true,
          quote: {
            ...quote,
            savingsKobo: quote.savingsKobo - 1,
            principalKobo: quote.principalKobo - 1,
            otherPaymentKobo: quote.otherPaymentKobo + 1,
          },
        })
      ).toMatchObject({
        status: 'unavailable',
        reservation: 'may_be_retained',
      });
    });
    it('rejects the wrong customer actor for quote and durable status', async () => {
      const runtime = createPurchasePreparation({
        configuration: configuration(207, goal(999)),
        execute: createPiggyvestPostgresExecutor(database()),
      });
      expect(await runtime.quote({ quoteId: goal(207) })).toEqual({
        status: 'unavailable',
      });
      expect(await runtime.status({ operationId: goal(4207) })).toMatchObject({
        status: 'unavailable',
      });
    });
    it('rejects non-policy roles and altered statements at the real executor boundary', async () => {
      const values = [
        '40000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        goal(207),
        'synthetic-business',
        actorId,
        goal(207),
      ];
      await expect(
        createPiggyvestPostgresExecutor(database('piggyvest_staging_worker'))(
          PURCHASE_PREPARATION_STATEMENTS.purchaseQuote.text,
          values
        )
      ).rejects.toThrow();
      await expect(
        createPiggyvestPostgresExecutor(database())(
          `${PURCHASE_PREPARATION_STATEMENTS.purchaseQuote.text} `,
          values
        )
      ).rejects.toThrow();
    });
  }
);
