import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ record: vi.fn(), process: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/event-quarantine', () => ({
  digestRawBody: () => 'f'.repeat(64),
  recordQuarantineEvent: vi.fn(async () => 'recorded'),
}));
vi.mock('@/lib/piggyvest/webhook-inbox', () => ({
  recordPiggyvestEvent: (...args: unknown[]) => mocks.record(...args),
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) => mocks.process(...args),
}));
vi.mock('@/lib/piggyvest/primary-wallet-inflow-dispatch', () => ({
  dispatchPrimaryWalletInflow: vi.fn(async () => 'ignored'),
}));

import type { PiggyvestIntakeClient } from '@/lib/piggyvest/intake-client.types';
import {
  type DrainDeps,
  drainPiggyvestWebhookCaptures,
  MAX_DRAIN_ATTEMPTS,
} from '@/lib/piggyvest/webhook-capture-drain';
import { row } from '@/lib/piggyvest/webhook-capture-drain.test-support';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import {
  isAuthorizationQuarantine,
  isContentQuarantine,
  isKeySetIncompleteRetry,
  isKillSwitchDeferred,
  processVerifiedDelivery,
} from './process-delivery';
import { inflowEvent } from './route.test-support';

const inflow = JSON.stringify(inflowEvent);

/**
 * Deferred, not dropped: a captured money-in row replayed under the kill
 * switch must stay pending with its attempts unchanged however many drain
 * passes run, and credit exactly once after the switch is lifted.
 */

const client = {} as unknown as PiggyvestIntakeClient;

// In-memory queue with the database's attempt semantics: a claim spends an
// attempt, 'deferred' refunds it, 'needs_review' and 'processed' are terminal.
function queueDeps(stored: PiggyvestClaimedCapture) {
  const state = { attempts: 0, status: 'pending' as string };
  const deps: DrainDeps = {
    renew: async () => true,
    claim: async () => {
      if (state.status !== 'pending') return [];
      state.attempts += 1;
      return [{ ...stored, attempts: state.attempts }];
    },
    resolve: async (_id, _token, next) => {
      if (next === 'deferred') {
        state.attempts -= 1;
        state.status = 'pending';
      } else state.status = next;
      return true;
    },
    verify: () => ({
      status: 'verified',
      secret: 'matched-secret',
      families: ['legacy'],
      keyVersion: 'k-0123456789abcdef',
      keyStatus: 'current',
    }),
    process: async (delivery) => {
      const response = await processVerifiedDelivery(delivery, {
        createClient: () => client,
        getPiggyvestConfig: () => null,
      });
      return {
        status: response.status,
        authorizationQuarantine: isAuthorizationQuarantine(response),
        contentQuarantine: isContentQuarantine(response),
        keySetIncomplete: isKeySetIncompleteRetry(response),
        killSwitchDeferred: isKillSwitchDeferred(response),
      };
    },
  };
  return { state, deps };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.record.mockResolvedValue('new');
  mocks.process.mockResolvedValue('processed');
});
afterEach(() => vi.unstubAllEnvs());

it('keeps a captured money-in row pending with attempts unchanged under the kill switch, then credits once', async () => {
  vi.stubEnv('PIGGYVEST_KILL_SWITCH', 'true');
  const { state, deps } = queueDeps(
    row(inflow, 'ab'.repeat(64), { attempts: MAX_DRAIN_ATTEMPTS - 1 })
  );

  for (let pass = 0; pass < MAX_DRAIN_ATTEMPTS * 2; pass += 1) {
    const summary = await drainPiggyvestWebhookCaptures(deps);
    expect(summary).toMatchObject({ claimed: 1, retried: 1, needsReview: 0 });
  }
  expect(state).toEqual({ attempts: 0, status: 'pending' });
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.process).not.toHaveBeenCalled();

  vi.stubEnv('PIGGYVEST_KILL_SWITCH', 'false');
  const summary = await drainPiggyvestWebhookCaptures(deps);
  expect(summary.processed).toBe(1);
  expect(state.status).toBe('processed');
  expect(mocks.process).toHaveBeenCalledTimes(1);
  expect(await drainPiggyvestWebhookCaptures(deps)).toMatchObject({
    claimed: 0,
  });
});
