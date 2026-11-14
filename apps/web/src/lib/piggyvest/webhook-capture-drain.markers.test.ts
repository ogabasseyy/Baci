import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxSecrets: () => null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeSecrets: () => null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxSecrets: () => null,
}));

import {
  drainPiggyvestWebhookCaptures,
  MAX_DRAIN_ATTEMPTS,
} from './webhook-capture-drain';
import {
  drainDeps,
  inflow,
  type ResolvedCall,
  row,
  sign,
} from './webhook-capture-drain.test-support';
import { testKey } from './webhook-secret-union.test-support';

const key = testKey('explicit-incomplete-marker');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('explicit incomplete-key replay marker', () => {
  it.each(
    [200, 204, 299, 503].flatMap((status) =>
      [false, true].flatMap((incompleteKeySet) =>
        [1, MAX_DRAIN_ATTEMPTS].map((attempts) => ({
          status,
          incompleteKeySet,
          attempts,
        }))
      )
    )
  )('keeps status $status recoverable with verifier incomplete=$incompleteKeySet at attempt $attempts', async ({
    status,
    incompleteKeySet,
    attempts,
  }) => {
    const resolved: ResolvedCall[] = [];
    const stored = row(inflow, sign(key, inflow), { attempts });
    const process = vi.fn(async () => ({ status, keySetIncomplete: true }));
    const deps = drainDeps(
      () => ({ env: { NODE_ENV: 'test' }, resolved }),
      [[stored]],
      process
    );
    deps.verify = () => ({
      status: 'verified',
      secret: key,
      families: ['legacy'],
      keyVersion: 'k-marker',
      keyStatus: 'current',
      incompleteKeySet,
    });

    expect(await drainPiggyvestWebhookCaptures(deps)).toMatchObject({
      claimed: 1,
      processed: 0,
      retried: 1,
      needsReview: 0,
    });
    expect(process).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual([
      { id: stored.capture_id, state: 'deferred', error: 'KEY_SET_INCOMPLETE' },
    ]);
  });
});
