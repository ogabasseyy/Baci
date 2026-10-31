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

import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { deterministicTestKey } from './deterministic-test-data.test-support';
import { drainPiggyvestWebhookCaptures } from './webhook-capture-drain';
import { drainDeps, row, sign } from './webhook-capture-drain.test-support';

/**
 * Rows that can never complete must leave the claimable set after one replay
 * instead of taking every batch: with 25 older wrong-family captures and one
 * younger healthy one, the healthy row must be reached on the second run.
 */

const key = deterministicTestKey('drain-starvation');
const BATCH = 25;
const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', PIGGYVEST_SECRET_KEY: key };

type Slot = {
  row: PiggyvestClaimedCapture;
  state: 'pending' | 'processed' | 'needs_review';
};
const bodyOf = (name: string) =>
  JSON.stringify({ eventId: name, eventType: 'x' });

let slots: Slot[];

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  slots = [
    ...Array.from({ length: BATCH }, (_, index) => `bad-${index}`),
    'healthy',
  ].map((name) => ({
    row: row(bodyOf(name), sign(key, bodyOf(name))),
    state: 'pending' as const,
  }));
});

function queueDeps() {
  const deps = drainDeps(
    () => ({ env, resolved: [] }),
    [],
    async (delivery) => ({
      status: 200,
      authorizationQuarantine: delivery.rawBody.toString().includes('bad-'),
    })
  );
  deps.claim = async (limit) =>
    slots
      .filter((slot) => slot.state === 'pending')
      .slice(0, limit)
      .map((slot) => slot.row);
  deps.resolve = async (id, _token, state) => {
    const slot = slots.find((candidate) => candidate.row.capture_id === id);
    if (!slot) return false;
    slot.state = state === 'deferred' ? 'pending' : state;
    return true;
  };
  return deps;
}

describe('a full batch of captures that can never complete', () => {
  it('leaves the claimable set after one run, so the next run reaches the healthy row', async () => {
    const deps = queueDeps();

    const first = await drainPiggyvestWebhookCaptures(deps, { limit: BATCH });
    expect(first).toMatchObject({ claimed: BATCH, needsReview: BATCH });
    expect(slots.filter((slot) => slot.state === 'needs_review')).toHaveLength(
      BATCH
    );

    const second = await drainPiggyvestWebhookCaptures(deps, { limit: BATCH });

    expect(second).toMatchObject({ claimed: 1, processed: 1 });
    expect(slots.at(-1)?.state).toBe('processed');
  });
});
