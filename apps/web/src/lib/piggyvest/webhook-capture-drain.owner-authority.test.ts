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
import {
  type DrainDeps,
  drainPiggyvestWebhookCaptures,
} from './webhook-capture-drain';
import {
  drainDeps,
  HOUR,
  NOW,
  type ResolvedCall,
  row,
  sign,
} from './webhook-capture-drain.test-support';
import { testKey } from './webhook-secret-union.test-support';

/**
 * A primary-owned event type (custody outflow, paid interest) is never
 * completed by the legacy fallback while its owning family is absent from
 * the families the replay processes with. The authority recorded at
 * admission is immutable and replay never widens it:
 * - the key now holds the owning family but admission did not record it:
 *   review (a resend gets a fresh row), whatever the key set looks like now;
 * - admission recorded it but the key no longer holds it: review with a
 *   complete key set, deferred while the key set is incomplete;
 * - a key that never held the owning family stays a legacy delivery.
 */

const key = testKey('owner-authority');
const BODIES = {
  custody: JSON.stringify({
    eventId: 'evt-custody-1',
    eventType: 'wallet-transfer.outflow.success',
    eventData: {},
  }),
  interest: JSON.stringify({
    eventId: 'evt-interest-1',
    eventType: 'interest-payout.success',
    eventData: {},
  }),
} as const;

const archiveAssigning = (family: 'custody' | 'interest') =>
  JSON.stringify([
    {
      version: `k-${family}`,
      family,
      secret: key,
      retiredAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    },
  ]);
const envWith = (archive: string): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  PIGGYVEST_SECRET_KEY: key,
  PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archive,
});

let resolved: ResolvedCall[];
let alerts: ReturnType<typeof vi.spyOn>;
let process: ReturnType<typeof vi.fn<DrainDeps['process']>>;

beforeEach(() => {
  resolved = [];
  process = vi.fn(async () => ({ status: 200 }));
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  alerts.mockClear();
});

function drain(
  body: string,
  recorded: PiggyvestClaimedCapture['key_families'],
  env: NodeJS.ProcessEnv
) {
  const stored = row(body, sign(key, body), { key_families: recorded });
  const deps = drainDeps(() => ({ env, resolved }), [[stored]], process);
  return { stored, run: () => drainPiggyvestWebhookCaptures(deps) };
}

describe.each(['custody', 'interest'] as const)('%s event', (owner) => {
  const body = BODIES[owner];

  it('goes to review, never legacy, when the key now holds the owner but admission did not record it', async () => {
    const { stored, run } = drain(
      body,
      ['legacy'],
      envWith(archiveAssigning(owner))
    );

    const summary = await run();

    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'needs_review',
        error: 'OWNER_FAMILY_NOT_RECORDED',
      },
    ]);
    expect(process).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ needsReview: 1, processed: 0 });
    // Names the capture so a resend can be requested; never the secret.
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_NEEDS_REVIEW')
    );
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining(stored.capture_id)
    );
    expect(alerts).not.toHaveBeenCalledWith(expect.stringContaining(key));
  });

  it('stays a legacy delivery for a key that never held the owning family (control)', async () => {
    const { run } = drain(body, ['legacy'], envWith('[]'));

    const summary = await run();

    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({ families: ['legacy'] })
    );
    expect(resolved).toEqual([
      expect.objectContaining({ state: 'processed', error: null }),
    ]);
    expect(summary).toMatchObject({ processed: 1 });
  });

  it('runs the owning intake path when the owner was recorded and is still held', async () => {
    const { run } = drain(
      body,
      ['legacy', owner],
      envWith(archiveAssigning(owner))
    );

    await run();

    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        families: expect.arrayContaining(['legacy', owner]),
      })
    );
    expect(resolved).toEqual([expect.objectContaining({ state: 'processed' })]);
  });

  it('goes to review when the recorded owner is no longer held and the key set is complete', async () => {
    const { stored, run } = drain(body, ['legacy', owner], envWith('[]'));

    await run();

    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'needs_review',
        error: 'OWNER_AUTHORITY_LOST',
      },
    ]);
    expect(process).not.toHaveBeenCalled();
  });

  it('defers the same row while the key set is incomplete (the assignment may come back)', async () => {
    const { run } = drain(body, ['legacy', owner], envWith('{not json'));

    const summary = await run();

    expect(resolved).toEqual([
      expect.objectContaining({
        state: 'deferred',
        error: 'KEY_SET_INCOMPLETE',
      }),
    ]);
    expect(process).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ retried: 1, needsReview: 0 });
  });

  it('cannot be rescued by waiting when the owner is held but unrecorded, even with an incomplete key set', async () => {
    const stored = row(body, sign(key, body), { key_families: ['legacy'] });
    const deps = drainDeps(
      () => ({ env: envWith('[]'), resolved }),
      [[stored]],
      process
    );
    deps.verify = () => ({
      status: 'verified',
      secret: key,
      families: ['legacy', owner],
      keyFamilies: ['legacy', owner],
      keyVersion: 'k',
      keyStatus: 'current',
      incompleteKeySet: true,
    });

    await drainPiggyvestWebhookCaptures(deps);

    expect(resolved).toEqual([
      expect.objectContaining({
        state: 'needs_review',
        error: 'OWNER_FAMILY_NOT_RECORDED',
      }),
    ]);
    expect(process).not.toHaveBeenCalled();
  });
});
