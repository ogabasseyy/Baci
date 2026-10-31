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

import type { StoredPiggyvestDeliveryVerification } from './verify-stored-piggyvest-delivery';
import {
  type DrainDeps,
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

/**
 * The rule, pinned in one place: when replay verification reports an
 * incomplete key set (unreadable archive, a family that failed to load),
 * EVERY unsuccessful processing outcome settles as `deferred` (attempt
 * refunded, bounded backoff, never dead-lettered), because the loaded
 * families may simply be missing the assignment that authorizes the event.
 * With a complete key set nothing changes: failures spend attempts and
 * escalate to review once the budget is gone.
 */

const key = testKey('drain-incomplete');
let resolved: ResolvedCall[];
let alerts: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resolved = [];
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  alerts.mockClear();
});

const KEYS_ALERT = 'PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED';

const verified = (
  incompleteKeySet: boolean,
  families: ('legacy' | 'interest' | 'bank')[] = ['legacy']
): StoredPiggyvestDeliveryVerification => ({
  status: 'verified',
  secret: key,
  families,
  keyVersion: 'k',
  keyStatus: 'current',
  incompleteKeySet,
});

const processed: DrainDeps['process'] = async () => ({ status: 200 });
const OUTCOMES: [string, DrainDeps['process']][] = [
  ['an ordinary 503 from the legacy ledger', async () => ({ status: 503 })],
  [
    'a thrown error',
    async () => {
      throw new Error('ledger unavailable');
    },
  ],
  [
    'an authorization quarantine',
    async () => ({ status: 200, authorizationQuarantine: true }),
  ],
];

function drainOnce(options: {
  incompleteKeySet: boolean;
  attempts: number;
  process: DrainDeps['process'];
  families?: ('legacy' | 'interest' | 'bank')[];
}) {
  const stored = row(inflow, sign(key, inflow), {
    key_families: ['legacy', 'interest'],
    attempts: options.attempts,
  });
  const deps = drainDeps(
    () => ({ env: { NODE_ENV: 'test' }, resolved }),
    [[stored]],
    options.process
  );
  deps.verify = () => verified(options.incompleteKeySet, options.families);
  return drainPiggyvestWebhookCaptures(deps);
}

describe('replay with an INCOMPLETE key set', () => {
  it.each(
    OUTCOMES.flatMap(([name, process]) =>
      [1, MAX_DRAIN_ATTEMPTS].map(
        (attempts) => [name, attempts, process] as const
      )
    )
  )('defers %s at attempt %i, never failing or escalating the row', async (_name, attempts, process) => {
    const summary = await drainOnce({
      incompleteKeySet: true,
      attempts,
      process,
    });

    expect(resolved).toEqual([
      expect.objectContaining({
        state: 'deferred',
        error: 'KEY_SET_INCOMPLETE',
      }),
    ]);
    expect(summary).toMatchObject({ retried: 1, needsReview: 0, processed: 0 });
    // Visible to operators, so a stuck row is not discovered later; the
    // alert names the capture and never a secret or the body.
    expect(alerts).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining(`${KEYS_ALERT} {"reason":"replay deferred`)
    );
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining(resolved[0]?.id ?? 'missing')
    );
    expect(alerts).not.toHaveBeenCalledWith(expect.stringContaining(key));
  });

  it('defers a replay whose reported families leave none of the recorded ones', async () => {
    const summary = await drainOnce({
      incompleteKeySet: true,
      attempts: MAX_DRAIN_ATTEMPTS,
      process: processed,
      families: ['bank'],
    });

    expect(resolved).toEqual([
      expect.objectContaining({
        state: 'deferred',
        error: 'KEY_SET_INCOMPLETE',
      }),
    ]);
    expect(summary).toMatchObject({ retried: 1, needsReview: 0 });
  });

  it('still resolves a successful outcome as processed', async () => {
    const summary = await drainOnce({
      incompleteKeySet: true,
      attempts: 1,
      process: processed,
    });

    expect(resolved).toEqual([
      expect.objectContaining({ state: 'processed', error: null }),
    ]);
    expect(summary).toMatchObject({ processed: 1 });
    expect(alerts).not.toHaveBeenCalledWith(
      expect.stringContaining(KEYS_ALERT)
    );
  });
});

describe('replay with a COMPLETE key set (behaviour unchanged)', () => {
  it.each(
    OUTCOMES
  )('keeps %s as a plain retry that spends the attempt', async (_name, process) => {
    const summary = await drainOnce({
      incompleteKeySet: false,
      attempts: 1,
      process,
    });

    expect(resolved).toEqual([
      expect.objectContaining({
        state: 'pending',
        error: 'PROCESSING_INCOMPLETE',
      }),
    ]);
    expect(summary).toMatchObject({ retried: 1, needsReview: 0 });
    expect(alerts).not.toHaveBeenCalledWith(
      expect.stringContaining(KEYS_ALERT)
    );
  });

  it.each(
    OUTCOMES
  )('escalates %s to review once the attempt budget is spent', async (_name, process) => {
    const summary = await drainOnce({
      incompleteKeySet: false,
      attempts: MAX_DRAIN_ATTEMPTS,
      process,
    });

    expect(resolved).toEqual([
      expect.objectContaining({
        state: 'needs_review',
        error: 'PROCESSING_ATTEMPTS_EXHAUSTED',
      }),
    ]);
    expect(summary).toMatchObject({ needsReview: 1 });
  });

  it('escalates a replay that leaves none of the recorded families', async () => {
    const summary = await drainOnce({
      incompleteKeySet: false,
      attempts: 1,
      process: processed,
      families: ['bank'],
    });

    expect(resolved).toEqual([
      expect.objectContaining({
        state: 'needs_review',
        error: 'REPLAY_AUTHORITY_NOT_RECORDED',
      }),
    ]);
    expect(summary).toMatchObject({ needsReview: 1 });
  });
});

describe('a [legacy, interest] capture whose archived interest assignment is unreadable', () => {
  const stored = () =>
    row(inflow, sign(key, inflow), {
      key_families: ['legacy', 'interest'],
      attempts: MAX_DRAIN_ATTEMPTS,
    });

  it('replays verified as legacy with an incomplete key set and defers the legacy ledger failure', async () => {
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: key,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: '{not json',
    };
    const process = vi.fn(async () => ({ status: 503 }));
    const deps = drainDeps(() => ({ env, resolved }), [[stored()]], process);

    const summary = await drainPiggyvestWebhookCaptures(deps);

    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({ families: ['legacy'], incompleteKeySet: true })
    );
    expect(resolved).toEqual([
      expect.objectContaining({
        state: 'deferred',
        error: 'KEY_SET_INCOMPLETE',
      }),
    ]);
    expect(summary).toMatchObject({ retried: 1, needsReview: 0 });
  });

  it('resumes once the archive is readable and the interest assignment is back', async () => {
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: key,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: JSON.stringify([
        {
          version: 'k-interest',
          family: 'interest',
          secret: key,
          retiredAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        },
      ]),
    };
    const process = vi.fn(async () => ({ status: 200 }));
    const deps = drainDeps(() => ({ env, resolved }), [[stored()]], process);

    const summary = await drainPiggyvestWebhookCaptures(deps);

    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        families: expect.arrayContaining(['legacy', 'interest']),
        incompleteKeySet: false,
      })
    );
    expect(summary).toMatchObject({ processed: 1 });
  });
});
