import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bank: vi.fn(),
  inflow: vi.fn(),
  custody: vi.fn(),
  interest: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-intake', () => ({
  dispatchPrimaryWalletBankInboxIntake: mocks.bank,
}));
vi.mock('@/lib/piggyvest/primary-wallet-inflow-dispatch', () => ({
  dispatchPrimaryWalletInflow: mocks.inflow,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-dispatch', () => ({
  dispatchPrimaryCardSignedCustodyIntake: mocks.custody,
}));
vi.mock('@/lib/piggyvest/primary-interest-webhook-response', () => ({
  primaryInterestWebhookResponse: mocks.interest,
}));

import {
  drainPiggyvestWebhookCaptures,
  MAX_DRAIN_ATTEMPTS,
} from './webhook-capture-drain';
import {
  drainDeps,
  type ResolvedCall,
  row,
  schemaValidInflow,
} from './webhook-capture-drain.test-support';
import { replayPrimaryDelivery } from './webhook-capture-primary-replay';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PIGGYVEST_KILL_SWITCH', 'true');
  mocks.bank.mockResolvedValue({
    response: new Response('{}', { status: 200 }),
  });
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  1,
  MAX_DRAIN_ATTEMPTS,
])('defers a real dispatcher pause at attempt %i and completes after resume', async (attempts) => {
  const resolved: ResolvedCall[] = [];
  const stored = row(
    schemaValidInflow('pause-resume-1', 'bank-transfer.inflow.success'),
    'ab'.repeat(64),
    { attempts, key_families: ['bank'] }
  );
  const deps = drainDeps(
    () => ({ env: { NODE_ENV: 'test' }, resolved }),
    [[stored], [stored]],
    replayPrimaryDelivery
  );
  deps.verify = () => ({
    status: 'verified',
    secret: 'fixture-only',
    families: ['bank'],
    keyVersion: 'k-pause',
    keyStatus: 'current',
  });

  // One claimed batch per pass; leave the second batch for the resumed pass.
  const claim = vi.fn().mockResolvedValueOnce([stored]).mockResolvedValue([]);
  deps.claim = claim;
  expect(await drainPiggyvestWebhookCaptures(deps)).toMatchObject({
    processed: 0,
    retried: 1,
    needsReview: 0,
  });
  expect(resolved).toEqual([
    { id: stored.capture_id, state: 'deferred', error: 'KILL_SWITCH_ACTIVE' },
  ]);
  expect(mocks.bank).not.toHaveBeenCalled();
  expect(mocks.inflow).not.toHaveBeenCalled();

  vi.stubEnv('PIGGYVEST_KILL_SWITCH', 'false');
  claim.mockResolvedValueOnce([stored]);
  expect(await drainPiggyvestWebhookCaptures(deps)).toMatchObject({
    processed: 1,
    retried: 0,
    needsReview: 0,
  });
  expect(resolved[1]).toEqual({
    id: stored.capture_id,
    state: 'processed',
    error: null,
  });
  expect(mocks.bank).toHaveBeenCalledTimes(1);
});
