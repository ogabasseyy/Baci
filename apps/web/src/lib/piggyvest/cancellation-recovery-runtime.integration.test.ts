import { describe, expect, it, vi } from 'vitest';
import { createCancelPlan } from './cancel-plan';
import { createCancellationRecoveryHandler } from './cancellation-recovery';
import { cancellationRecoveryFixture } from './cancellation-recovery.test-support';
import { createPiggyvestPostgresExecutor } from './postgres-executor';

vi.mock('server-only', () => ({}));

describe.skipIf(process.env.PIGGYVEST_RUN_CANCELLATION_RECOVERY !== '1')(
  'durable recovery through real restricted PostgreSQL',
  () => {
    it('recovers original reservation after lost response or database restart without resubmitting', async () => {
      const execute = createPiggyvestPostgresExecutor({
        environment: 'staging',
        transport: 'local_test',
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        database: 'piggyvest_local',
        password: 'synthetic-local-only',
        role: 'piggyvest_staging_policy_writer',
        port: 55445,
      });
      const fixture = cancellationRecoveryFixture(execute);
      const handler = createCancellationRecoveryHandler(fixture.options);
      if (process.env.PIGGYVEST_RECOVERY_AFTER_RESTART !== '1') {
        const before = await handler.GET(fixture.request());
        expect(before.status).toBe(200);
        expect(await before.json()).toMatchObject({
          status: 'absent',
          reservation: 'unknown',
          retry: 'not_authorized',
        });
        const plan = createCancelPlan({
          configuration: {
            environment: 'staging',
            transport: 'local_test',
            integrationId: fixture.options.configuration.integrationId,
            merchantId: fixture.options.configuration.merchantId,
            customerId: fixture.options.configuration.allowlistedCustomerIds[0],
            goalId: fixture.goalId,
            actorId: fixture.actorId,
            expectedBusinessId: 'synthetic-business',
          },
          execute: async (statement, parameters) => {
            await execute(statement, parameters);
            throw new Error('Synthetic response lost after commit');
          },
        });
        expect(
          await plan.prepare({
            ...fixture.prepared.originalDisclosure,
            operationId: fixture.operationId,
            actorId: fixture.actorId,
            accepted: true,
          })
        ).toMatchObject({
          status: 'unavailable',
          reservation: 'may_be_retained',
        });
      }
      const exact = await handler.GET(fixture.request());
      expect(exact.status).toBe(200);
      expect(await exact.json()).toEqual(fixture.prepared);
      const reload = await createCancellationRecoveryHandler(
        fixture.options
      ).GET(fixture.request(`goalId=${fixture.goalId}`));
      expect(reload.status).toBe(200);
      expect(await reload.json()).toEqual({
        ...fixture.prepared,
        requestedOperationId: null,
      });
      expect(
        fixture.execute.mock.calls.every(([statement]) =>
          statement.includes('read_recovery(')
        )
      ).toBe(true);
      const wrongActor = cancellationRecoveryFixture(execute);
      wrongActor.getUser.mockResolvedValue({
        data: { user: { id: fixture.operationId } },
        error: null,
      });
      expect(
        (
          await createCancellationRecoveryHandler(wrongActor.options).GET(
            wrongActor.request()
          )
        ).status
      ).toBe(403);
      expect(wrongActor.execute).not.toHaveBeenCalled();
    });
  }
);
