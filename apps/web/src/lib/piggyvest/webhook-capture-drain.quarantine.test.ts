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

import { deterministicTestKey } from './deterministic-test-data.test-support';
import {
  drainPiggyvestWebhookCaptures,
  MAX_DRAIN_ATTEMPTS,
} from './webhook-capture-drain';
import {
  drainDeps,
  type ResolvedCall,
  row,
  sign,
} from './webhook-capture-drain.test-support';

const key = deterministicTestKey('drain-quarantine');
const body = JSON.stringify({ eventId: 'evt-q', eventType: 'x' });
const COMPLETE: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PIGGYVEST_SECRET_KEY: key,
};
const INCOMPLETE: NodeJS.ProcessEnv = {
  ...COMPLETE,
  PIGGYVEST_WEBHOOK_KEY_ARCHIVE: '{not json',
};

type Result = {
  status: number;
  authorizationQuarantine?: boolean;
  contentQuarantine?: boolean;
};
let alerts: ReturnType<typeof vi.spyOn>;
let resolved: ResolvedCall[];

beforeEach(() => {
  resolved = [];
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  alerts.mockClear();
});

function replay(result: Result, env: NodeJS.ProcessEnv, attempts = 1) {
  const stored = row(body, sign(key, body), { attempts });
  const deps = drainDeps(
    () => ({ env, resolved }),
    [[stored]],
    async () => result
  );
  return { stored, run: () => drainPiggyvestWebhookCaptures(deps) };
}

describe('authorization quarantine during replay (complete key set)', () => {
  it.each([
    1,
    MAX_DRAIN_ATTEMPTS,
  ])('goes straight to review at attempt %i: it can never succeed, and never resolves as processed', async (attempts) => {
    const { stored, run } = replay(
      { status: 200, authorizationQuarantine: true },
      COMPLETE,
      attempts
    );

    const summary = await run();

    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'needs_review',
        error: 'REPLAY_AUTHORIZATION_QUARANTINED',
      },
    ]);
    expect(summary).toMatchObject({ needsReview: 1, retried: 0, processed: 0 });
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_NEEDS_REVIEW')
    );
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining(stored.capture_id)
    );
  });

  it('still resolves an ordinary completed result as processed', async () => {
    const { run } = replay({ status: 200 }, COMPLETE);

    await run();

    expect(resolved).toEqual([
      expect.objectContaining({ state: 'processed', error: null }),
    ]);
  });

  it('defers instead while the key set is incomplete (the right family may load)', async () => {
    const { run } = replay(
      { status: 200, authorizationQuarantine: true },
      INCOMPLETE
    );

    await run();

    expect(resolved).toEqual([
      expect.objectContaining({
        state: 'deferred',
        error: 'KEY_SET_INCOMPLETE',
      }),
    ]);
  });
});

describe('content quarantine during replay (unparseable or schema-rejected body)', () => {
  it.each([
    ['complete', COMPLETE],
    ['incomplete', INCOMPLETE],
  ])('is parked for review, never processed, with a %s key set', async (_label, env) => {
    const { stored, run } = replay(
      { status: 200, contentQuarantine: true },
      env
    );

    const summary = await run();

    // The bytes verified, so the key set cannot change the content outcome:
    // a resend after the schema fix is what makes it processable again.
    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'needs_review',
        error: 'REPLAY_CONTENT_QUARANTINED',
      },
    ]);
    expect(summary).toMatchObject({ needsReview: 1, processed: 0, retried: 0 });
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining(stored.capture_id)
    );
  });
});
