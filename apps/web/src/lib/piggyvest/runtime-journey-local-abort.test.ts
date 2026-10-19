// @vitest-environment node

import { setImmediate } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { startRuntimeJourneyLocal } from './runtime-journey-local';

vi.mock('server-only', () => ({}));

it.skipIf(process.env.PIGGYVEST_RUN_RUNTIME_JOURNEY !== '1')(
  'aborts an actual HTTP funding read without dispatching the subsequent account read',
  async () => {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const server = await startRuntimeJourneyLocal({
      socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
      sequence: 704,
      providerReadBarrier: () => {
        entered();
        return barrier;
      },
    });
    try {
      await server.bootstrap();
      const policy = await (
        await server.request(`/policy?goalId=${server.goalId}`)
      ).json();
      expect(
        (
          await server.request('/lifecycle/terms', {
            method: 'POST',
            body: JSON.stringify({
              goalId: server.goalId,
              revisionId: server.revisionId,
              durationMonths: 1,
            }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await server.request('/policy', {
            method: 'POST',
            body: JSON.stringify({
              goalId: server.goalId,
              revisionId: server.revisionId,
              termsVersion: policy.terms.version,
              termsHash: policy.terms.hash,
              durationMonths: 1,
              accepted: true,
            }),
          })
        ).status
      ).toBe(200);
      const pending = server.request(`/funding?goalId=${server.goalId}`).then(
        () => 'response',
        () => 'disconnected'
      );
      await started;
      await server.close();
      release();
      expect(await pending).toBe('disconnected');
      await setImmediate();
      expect(server.providerCalls).toEqual([
        'https://staging.piggyvest.business/api/v1/wallet/synthetic-wallet-704',
      ]);
    } finally {
      release();
      await server.close();
    }
  },
  15000
);
