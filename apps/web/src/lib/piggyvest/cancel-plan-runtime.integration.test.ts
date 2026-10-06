import { describe, expect, it, vi } from 'vitest';
import { createCancelPlan } from './cancel-plan';
import { CANCEL_PLAN_STATEMENTS } from './cancel-plan-statements';
import { createPiggyvestPostgresExecutor } from './postgres-executor';

vi.mock('server-only', () => ({}));

describe.skipIf(process.env.PIGGYVEST_RUN_CANCEL_PLAN_RUNTIME !== '1')(
  'cancel plan through the standard restricted executor and real PostgreSQL',
  () => {
    it('quotes, commits principal reservation, and replays without dispatch', async () => {
      const execute = createPiggyvestPostgresExecutor({
        environment: 'staging',
        transport: 'local_test',
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        database: 'piggyvest_local',
        password: 'synthetic-local-only',
        role: 'piggyvest_staging_policy_writer',
        port: 55446,
      });
      const actorId = '90000000-0000-4000-8000-000000000001';
      const runtime = createCancelPlan({
        execute,
        configuration: {
          environment: 'staging',
          transport: 'local_test',
          integrationId: '40000000-0000-4000-8000-000000000001',
          merchantId: '10000000-0000-4000-8000-000000000001',
          customerId: '20000000-0000-4000-8000-000000000001',
          goalId: '30000000-0000-4000-8000-000000000101',
          expectedBusinessId: 'synthetic-business',
          actorId,
        },
      });
      const quote = await runtime.quote();
      expect(quote).toMatchObject({
        status: 'quote_available',
        principalKobo: 100,
        paidInterestKobo: 7,
        pendingInterestKobo: 3,
        interestDisposition: 'unresolved',
      });
      if (quote.status !== 'quote_available') throw new Error('Missing quote');
      const command = {
        operationId: '80000000-0000-4000-8000-000000000101',
        actorId,
        revisionId: quote.revisionId,
        termsVersion: quote.termsVersion,
        termsHash: quote.termsHash,
        consentVersion: quote.consentVersion,
        accepted: true,
        principalKobo: quote.principalKobo,
        paidInterestKobo: quote.paidInterestKobo,
        pendingInterestKobo: quote.pendingInterestKobo,
      };
      const receipt = await runtime.prepare(command);
      expect(receipt).toEqual({
        status: 'prepared',
        operationId: command.operationId,
        collectionPaused: true,
        dispatch: 'contract_gap',
        interestDisposition: 'unresolved',
      });
      expect(await runtime.prepare(command)).toEqual(receipt);
      const reloaded = await execute(
        CANCEL_PLAN_STATEMENTS.quoteCancelPlan.text,
        [
          '40000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000101',
          'synthetic-business',
          actorId,
        ]
      );
      expect(reloaded.rows).toMatchObject([
        {
          result: {
            policy: { revisionId: command.revisionId },
            ledgerSnapshot: {
              activeReservation: {
                operationId: command.operationId,
                principalKobo: 100,
                interestKobo: 0,
              },
            },
          },
        },
      ]);
      expect(runtime.dispatch().status).toBe('contract_gap');
      expect(
        await runtime.prepare({ ...command, principalKobo: 99 })
      ).toMatchObject({
        status: 'unavailable',
        reservation: 'may_be_retained',
      });
    });
  }
);
