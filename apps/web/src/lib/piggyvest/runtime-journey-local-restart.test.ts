// @vitest-environment node

import { expect, it, vi } from 'vitest';
import { startRuntimeJourneyLocal } from './runtime-journey-local';

vi.mock('server-only', () => ({}));

it.skipIf(process.env.PIGGYVEST_RUN_RUNTIME_JOURNEY !== '1')(
  'recovers activation, cancellation reservation and expired schedule after PostgreSQL and listener restart',
  async () => {
    for (const sequence of [701, 702, 703] as const) {
      const server = await startRuntimeJourneyLocal({
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        sequence,
      });
      try {
        await server.bootstrap();
        if (sequence === 701) {
          const response = await server.request('/lifecycle/activate', {
            method: 'POST',
            body: JSON.stringify({
              goalId: server.goalId,
              revisionId: server.revisionId,
              operationId: '80000000-0000-4000-8000-000000000701',
            }),
          });
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({
            lifecycle: 'active',
            evidence: 'local_synthetic_only',
            collectionConsent: 'not_granted',
          });
        } else if (sequence === 702) {
          const response = await server.request(
            `/recovery?goalId=${server.goalId}&operationId=80000000-0000-4000-8000-000000000702`
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({
            status: 'prepared',
            reservation: 'retained',
            dispatch: 'contract_gap',
            originalDisclosure: { principalKobo: 5000 },
          });
        } else {
          const response = await server.request(
            `/schedule?goalId=${server.goalId}`
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({
            state: { status: 'paused', consentProposal: null },
            debitPermission: false,
          });
        }
        expect(server.providerCalls).toHaveLength(0);
      } finally {
        await server.close();
      }
    }
  },
  30000
);
