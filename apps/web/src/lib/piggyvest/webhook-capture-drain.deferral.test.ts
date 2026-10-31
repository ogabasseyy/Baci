import { randomBytes } from 'node:crypto';
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
  MAX_DRAIN_ATTEMPTS,
} from './webhook-capture-drain';
import {
  drainDeps,
  inflow,
  type ResolvedCall,
  row,
  sign,
} from './webhook-capture-drain.test-support';

/**
 * Configuration-blocked and incomplete-key-set scenarios: a row the drain
 * cannot verify or authorize yet is deferred (attempt refunded, bounded
 * backoff, never dead-lettered), while a complete configuration with
 * genuinely lost authority still escalates to review.
 */

let current: string;
let env: NodeJS.ProcessEnv;
let resolved: ResolvedCall[];
let alerts: ReturnType<typeof vi.spyOn>;

const deps = (
  claimed: PiggyvestClaimedCapture[][],
  process: DrainDeps['process']
) => drainDeps(() => ({ env, resolved }), claimed, process);

beforeEach(() => {
  current = randomBytes(32).toString('hex');
  env = { NODE_ENV: 'test', PIGGYVEST_SECRET_KEY: current };
  resolved = [];
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  alerts.mockClear();
});

describe('drainPiggyvestWebhookCaptures deferral', () => {
  it('defers the row with a backoff when keys are not configured', async () => {
    env = { NODE_ENV: 'test' };
    const stored = row(inflow, sign(current, inflow));
    const process = vi.fn(async () => ({ status: 200 }));

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[stored]], process)
    );

    expect(process).not.toHaveBeenCalled();
    // 'deferred' (not 'pending') is what lets the database schedule a retry
    // time, so a configuration-blocked old row stops being re-claimed ahead
    // of every later capture on each drain run.
    expect(resolved).toEqual([
      { id: stored.capture_id, state: 'deferred', error: 'KEYS_UNCONFIGURED' },
    ]);
    expect(summary.retried).toBe(1);
  });

  it('defers an unreadable-archive row instead of judging it unverifiable', async () => {
    const old = randomBytes(32).toString('hex');
    env = {
      NODE_ENV: 'test',
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: '{not json',
    };
    const stored = row(inflow, sign(old, inflow), {
      key_version: 'pv-2026-07',
    });
    const process = vi.fn(async () => ({ status: 200 }));

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[stored]], process)
    );

    expect(process).not.toHaveBeenCalled();
    expect(resolved).toEqual([
      { id: stored.capture_id, state: 'deferred', error: 'KEYS_UNCONFIGURED' },
    ]);
    expect(summary).toMatchObject({ retried: 1, needsReview: 0 });
  });

  it('defers, not escalates, a bank-only row whose archive is unreadable while its key matches another family', async () => {
    // Recorded as bank-only; the same key is now also the legacy secret and
    // the archive holding its bank assignment is malformed. Replay cannot
    // tell "authority lost" from "assignment not loaded", so it must retry.
    env = {
      NODE_ENV: 'test',
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: '{not json',
    };
    const stored = row(inflow, sign(current, inflow), {
      key_families: ['bank'],
    });
    const process = vi.fn(async () => ({ status: 200 }));

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[stored]], process)
    );

    expect(process).not.toHaveBeenCalled();
    expect(resolved).toEqual([
      { id: stored.capture_id, state: 'deferred', error: 'KEYS_UNCONFIGURED' },
    ]);
    expect(summary).toMatchObject({ retried: 1, needsReview: 0 });
  });

  it('still escalates a bank-only row to review when the configuration is complete and bank authority is really gone', async () => {
    env = {
      NODE_ENV: 'test',
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: '[]',
    };
    const stored = row(inflow, sign(current, inflow), {
      key_families: ['bank'],
    });
    const process = vi.fn(async () => ({ status: 200 }));

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[stored]], process)
    );

    expect(process).not.toHaveBeenCalled();
    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'needs_review',
        error: 'REPLAY_AUTHORITY_NOT_RECORDED',
      },
    ]);
    expect(summary.needsReview).toBe(1);
  });

  it('defers, never dead-letters, a row whose processing needs a key family that is not loaded yet', async () => {
    // The replay verified under part of the key set; processing could not
    // decide the family authority and asks for a retry once config is whole.
    const stored = row(inflow, sign(current, inflow), {
      attempts: MAX_DRAIN_ATTEMPTS + 5,
    });
    const process = vi.fn(async () => ({
      status: 503,
      keySetIncomplete: true,
    }));

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[stored]], process)
    );

    expect(process).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual([
      { id: stored.capture_id, state: 'deferred', error: 'KEY_SET_INCOMPLETE' },
    ]);
    expect(summary).toMatchObject({ retried: 1, needsReview: 0 });
  });

  it('hands the replay the incomplete-key-set signal from verification', async () => {
    env = {
      NODE_ENV: 'test',
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: '{not json',
    };
    const stored = row(inflow, sign(current, inflow));
    const process = vi.fn(async () => ({ status: 200 }));

    await drainPiggyvestWebhookCaptures(deps([[stored]], process));

    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({ incompleteKeySet: true })
    );
  });

  it('never dead-letters a configuration-blocked row, whatever its attempt count', async () => {
    env = { NODE_ENV: 'test' };
    const stored = row(inflow, sign(current, inflow), {
      attempts: MAX_DRAIN_ATTEMPTS + 5,
    });

    const summary = await drainPiggyvestWebhookCaptures(
      deps([[stored]], async () => ({ status: 200 }))
    );

    expect(resolved).toEqual([
      { id: stored.capture_id, state: 'deferred', error: 'KEYS_UNCONFIGURED' },
    ]);
    expect(summary).toMatchObject({ retried: 1, needsReview: 0 });
    expect(alerts).not.toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_NEEDS_REVIEW')
    );
  });
});
