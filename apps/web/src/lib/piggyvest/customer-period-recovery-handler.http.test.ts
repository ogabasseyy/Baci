// @vitest-environment node
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';

vi.mock('server-only', () => ({}));
it.skipIf(process.env.PIGGYVEST_RUN_PERIOD_RECOVERY !== '1')(
  'synthetic session HTTP reads actual restricted canonical history after PostgreSQL restart without writes',
  async () => {
    const database = createPiggyvestPostgresExecutor({
      environment: 'staging',
      transport: 'local_test',
      socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
      database: 'piggyvest_local',
      role: 'piggyvest_staging_policy_writer',
      password: 'synthetic-local-only',
      port: 55459,
    });
    const fixture = scheduleStoreRuntimeFixture(1, database);
    const execute = vi.fn(database);
    const text = 'Synthetic metadata read only. No financial authority.';
    const server = await startPiggyvestRuntimeCompositionServer({
      port: 0,
      configuration: {
        mode: 'local_test',
        goalId: fixture.goalId,
        context: fixture.options.configuration,
        termsDocument: {
          version: 'synthetic-period',
          text,
          hash: createHash('sha256').update(text).digest('hex'),
        },
      },
      execute,
      services: { periodRecovery: { enabled: true } },
      createRlsClient: async (request) => {
        const session = scheduleStoreRuntimeFixture(1, database);
        if (request.cookies.get('synthetic-session')?.value !== 'owner')
          session.getUser.mockResolvedValue({
            data: { user: null },
            error: null,
          });
        return session.options.supabase;
      },
    });
    try {
      const read = (operation: string, authenticated = true, extra = '') =>
        fetch(
          `${server.origin}/period-attribution?goalId=${fixture.goalId}&ledgerOperationId=${operation}${extra}`,
          {
            headers: authenticated ? { cookie: 'synthetic-session=owner' } : {},
            redirect: 'error',
            signal: AbortSignal.timeout(8000),
          }
        );
      const paid = 'b0000000-0000-4000-8000-000000000001';
      expect((await read(paid, false)).status).toBe(401);
      expect(execute).not.toHaveBeenCalled();
      expect((await read(paid, true, '&amountKobo=1')).status).toBe(400);
      expect(execute).not.toHaveBeenCalled();
      const response = await read(paid);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        ledgerOperationId: paid,
        originalCreditKobo: 70,
        reversed: true,
        metadataRecorded: true,
        periodStatus: 'unknown',
        coveredPeriod: null,
        entitlement: 'unresolved',
        disposition: 'unresolved',
        fundsUse: 'not_authorized',
      });
      expect(body).not.toHaveProperty('record');
      expect(body).not.toHaveProperty('evidenceId');
      expect(JSON.stringify(body)).not.toContain(fixture.actorId);
      expect(
        await (await read('b0000000-0000-4000-8000-000000000002')).json()
      ).toMatchObject({
        kind: 'record_pending_interest',
        originalCreditKobo: 30,
        fundsUse: 'not_authorized',
      });
      expect((await read('b0000000-0000-4000-8000-000000000020')).status).toBe(
        503
      );
      expect(
        execute.mock.calls.every(([statement]) =>
          statement.startsWith('SELECT piggyvest_period_recovery.read(')
        )
      ).toBe(true);
    } finally {
      await server.close();
    }
  }
);
