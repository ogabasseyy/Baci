import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { DrainDeps } from './webhook-capture-drain';
import { inflow, row, sign } from './webhook-capture-drain.test-support';
import {
  MAX_DRAIN_ATTEMPTS,
  type ReplayProcessResult,
  settleReplayResult,
} from './webhook-capture-drain-result';

const stored = row(inflow, sign('result-key', inflow));
let resolve: ReturnType<typeof vi.fn<DrainDeps['resolve']>>;
let deps: DrainDeps;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  resolve = vi.fn<DrainDeps['resolve']>(async () => true);
  deps = {
    claim: async () => [],
    resolve,
    verify: () => ({ status: 'unconfigured' }),
    process: async () => ({ status: 200 }),
  };
});

async function settled(
  result: ReplayProcessResult | null,
  incomplete = false,
  target = stored
) {
  const outcome = await settleReplayResult(deps, target, result, incomplete);
  const [call] = resolve.mock.calls;
  return { outcome, state: call?.[2], error: call?.[3] };
}

describe('settleReplayResult', () => {
  it('resolves a clean 2xx as processed', async () => {
    await expect(settled({ status: 204 })).resolves.toEqual({
      outcome: 'processed',
      state: 'processed',
      error: null,
    });
  });

  it.each<[string, ReplayProcessResult, string, string]>([
    [
      'out of scope',
      { status: 200, outOfScope: 'LEGACY_PATH' },
      'deferred',
      'REPLAY_DEFERRED_LEGACY_PATH',
    ],
    [
      'a conflict',
      { status: 200, conflict: true },
      'needs_review',
      'REPLAY_CONFLICT',
    ],
    [
      'a content quarantine',
      { status: 200, contentQuarantine: true },
      'needs_review',
      'REPLAY_CONTENT_QUARANTINED',
    ],
    [
      'an authorization quarantine',
      { status: 200, authorizationQuarantine: true },
      'needs_review',
      'REPLAY_AUTHORIZATION_QUARANTINED',
    ],
    [
      'a key-set retry',
      { status: 503, keySetIncomplete: true },
      'deferred',
      'KEY_SET_INCOMPLETE',
    ],
    ['a plain failure', { status: 503 }, 'pending', 'PROCESSING_INCOMPLETE'],
  ])('never completes %s', async (_label, result, state, error) => {
    const outcome = await settled(result);
    expect(outcome.state).toBe(state);
    expect(outcome.error).toBe(error);
  });

  it('defers out-of-scope rows ahead of every other verdict', async () => {
    const outcome = await settled(
      {
        status: 503,
        outOfScope: 'LEGACY_PATH',
        keySetIncomplete: true,
        conflict: true,
      },
      true
    );
    expect(outcome.state).toBe('deferred');
    expect(outcome.error).toBe('REPLAY_DEFERRED_LEGACY_PATH');
  });

  it('treats a thrown attempt like a failed one, deferred while the key set is incomplete', async () => {
    await expect(settled(null)).resolves.toMatchObject({ state: 'pending' });
    resolve.mockClear();
    await expect(settled(null, true)).resolves.toMatchObject({
      state: 'deferred',
      error: 'KEY_SET_INCOMPLETE',
    });
  });

  it('dead-letters only after the attempt budget is spent', async () => {
    const exhausted = { ...stored, attempts: MAX_DRAIN_ATTEMPTS };
    await expect(settled({ status: 500 }, false, exhausted)).resolves.toEqual({
      outcome: 'needsReview',
      state: 'needs_review',
      error: 'PROCESSING_ATTEMPTS_EXHAUSTED',
    });
  });
});
