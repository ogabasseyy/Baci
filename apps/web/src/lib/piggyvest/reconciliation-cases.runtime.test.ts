import { describe, expect, it, vi } from 'vitest';
import { termsDocument } from './customer-purchase-http.fixture';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';

vi.mock('server-only', () => ({}));
const reversed = process.env.PIGGYVEST_RECONCILIATION_REVERSED === '1';
describe.skipIf(process.env.PIGGYVEST_RUN_RECONCILIATION_CASES !== '1')(
  'real HTTP and canonical reconciliation readback across restart',
  () => {
    it('reads original unresolved case and all canonical principal without making financial completion claims', async () => {
      const fixture = scheduleStoreRuntimeFixture(501);
      const server = await startPiggyvestRuntimeCompositionServer({
        port: 0,
        configuration: {
          mode: 'local_test',
          goalId: fixture.goalId,
          context: fixture.options.configuration,
          termsDocument,
        },
        createRlsClient: async () => fixture.options.supabase,
        execute: fixture.execute,
        services: { reconciliation: { enabled: true } },
      });
      try {
        const url = `${server.origin}/reconciliation?goalId=${fixture.goalId}&collectionOperationId=a2000000-0000-4000-8000-000000000501`;
        const response = await fetch(url);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({
          status: 'unresolved',
          observationCount: 3,
          financialEffects: 'UNKNOWN',
          fundsUse: 'not_authorized',
          alert: { delivery: 'not_dispatched' },
          canonicalCredit: { recordedPrincipalKobo: 50 },
          ledger: {
            confirmedPrincipalKobo: reversed ? 100 : 150,
            fundingReversed: reversed,
            pendingInterestKobo: reversed ? 15 : 0,
          },
        });
        const page = await (
          await fetch(
            `${server.origin}/reconciliation?goalId=${fixture.goalId}`
          )
        ).json();
        expect(page.cases).toHaveLength(50);
        const next = await (
          await fetch(
            `${server.origin}/reconciliation?goalId=${fixture.goalId}&after=${page.nextCursor}`
          )
        ).json();
        expect(next.cases).toHaveLength(2);
        expect(next.nextCursor).toBeNull();
        expect(JSON.stringify(body)).not.toMatch(
          /providerWalletId|providerCustomerId|collectionReference|incoming-501|wallet-501/
        );
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect((await fetch(url, { method: 'POST' })).status).toBe(405);
        expect(
          (
            await fetch(
              url.replace(fixture.goalId, fixture.goalId.replace(/501$/, '502'))
            )
          ).status
        ).toBe(403);
        fixture.getUser.mockResolvedValue({
          data: { user: { id: '90000000-0000-4000-8000-000000000002' } },
          error: null,
        });
        expect((await fetch(url)).status).not.toBe(200);
        fixture.getUser.mockResolvedValue({
          data: { user: null },
          error: null,
        });
        const calls = fixture.execute.mock.calls.length;
        expect((await fetch(url)).status).toBe(401);
        expect(fixture.execute).toHaveBeenCalledTimes(calls);
      } finally {
        await server.close();
      }
    });
  }
);
