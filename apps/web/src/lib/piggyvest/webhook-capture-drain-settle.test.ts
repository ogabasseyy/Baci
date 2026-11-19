import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { DrainDeps } from './webhook-capture-drain';
import { row } from './webhook-capture-drain.test-support';
import {
  deferForIncompleteKeySet,
  parkForReview,
  settle,
} from './webhook-capture-drain-settle';

const stored = row('{"eventId":"evt-1","eventType":"x"}', 'ab'.repeat(64), {
  key_version: 'k-version-1',
});
let resolve: ReturnType<typeof vi.fn<DrainDeps['resolve']>>;
let deps: DrainDeps;
let alerts: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resolve = vi.fn(async () => true);
  deps = {
    resolve,
    claim: async () => [],
    renew: async () => true,
    verify: () => ({ status: 'unconfigured' }),
    process: async () => ({ status: 503 }),
  };
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  alerts.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('settle', () => {
  it('reports safe diagnostics without exposing the original exception or provider payload', async () => {
    resolve.mockRejectedValue(
      Object.assign(new Error('private credential must not be logged'), {
        sqlState: '42501',
        providerResponse: 'private payload',
      })
    );
    expect(await settle(deps, stored, 'processed', null)).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      '[PiggyVest Webhook] Failed to resolve captured delivery',
      { captureId: stored.capture_id, phase: 'settle', sqlState: '42501' }
    );
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(
      /private credential|private payload/
    );
  });
  it('resolves the claimed row fenced by its own claim token', async () => {
    await settle(deps, stored, 'processed', null);

    expect(resolve).toHaveBeenCalledWith(
      stored.capture_id,
      stored.claim_token,
      'processed',
      null
    );
  });

  it('swallows a failed resolve and reports it unsettled: the lease expires and the row is claimed again', async () => {
    resolve.mockRejectedValue(new Error('database down'));

    await expect(settle(deps, stored, 'processed', null)).resolves.toBe(false);
  });

  it('reports a lost lease (the database matched no row) as unsettled', async () => {
    resolve.mockResolvedValue(false);
    await expect(settle(deps, stored, 'processed', null)).resolves.toBe(false);
    resolve.mockResolvedValue(true);
    await expect(settle(deps, stored, 'processed', null)).resolves.toBe(true);
  });
});

describe('deferForIncompleteKeySet', () => {
  it('settles deferred with the stable code and alerts on the capture only', async () => {
    await deferForIncompleteKeySet(deps, stored, 'processing incomplete');

    expect(resolve).toHaveBeenCalledWith(
      stored.capture_id,
      stored.claim_token,
      'deferred',
      'KEY_SET_INCOMPLETE'
    );
    expect(alerts).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED')
    );
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining(stored.capture_id)
    );
    expect(alerts).not.toHaveBeenCalledWith(
      expect.stringContaining(stored.signature)
    );
  });
});

describe('parkForReview', () => {
  it('settles needs_review with the code, alerts with context, and reports the outcome', async () => {
    const outcome = await parkForReview(
      deps,
      stored,
      'SOME_CODE',
      'because of a reason'
    );

    expect(outcome).toBe('needsReview');
    expect(resolve).toHaveBeenCalledWith(
      stored.capture_id,
      stored.claim_token,
      'needs_review',
      'SOME_CODE'
    );
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_NEEDS_REVIEW')
    );
    expect(alerts).toHaveBeenCalledWith(expect.stringContaining('k-version-1'));
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('because of a reason')
    );
  });

  it('neither counts nor alerts a review it did not record because the lease was lost', async () => {
    resolve.mockResolvedValue(false);

    await expect(parkForReview(deps, stored, 'CODE', 'r')).resolves.toBe(
      'retried'
    );
    expect(alerts).not.toHaveBeenCalled();
  });

  it('includes the attempt count only when given', async () => {
    await parkForReview(deps, stored, 'CODE', 'r', 20);
    expect(alerts).toHaveBeenLastCalledWith(
      expect.stringContaining('"attempts":20')
    );

    alerts.mockClear();
    await parkForReview(deps, stored, 'CODE', 'r');
    expect(alerts).not.toHaveBeenCalledWith(
      expect.stringContaining('attempts')
    );
  });
});
