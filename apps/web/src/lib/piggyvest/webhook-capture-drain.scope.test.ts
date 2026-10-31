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
  type DrainDeps,
  drainPiggyvestWebhookCaptures,
  type ReplayProcessResult,
} from './webhook-capture-drain';
import {
  drainDeps,
  inflow,
  type ResolvedCall,
  row,
  sign,
} from './webhook-capture-drain.test-support';

const key = deterministicTestKey('drain-scope');
const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', PIGGYVEST_SECRET_KEY: key };

let resolved: ResolvedCall[];
let alerts: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resolved = [];
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  alerts.mockClear();
});

const alertLines = () =>
  alerts.mock.calls.map((call: unknown[]) => String(call[0]));

function depsFor(
  result: ReplayProcessResult,
  outOfScope?: DrainDeps['outOfScope']
) {
  const stored = row(inflow, sign(key, inflow));
  const process = vi.fn(async () => result);
  const base = drainDeps(() => ({ env, resolved }), [[stored]], process);
  const verify = vi.fn(base.verify);
  return {
    stored,
    process,
    verify,
    deps: { ...base, verify, outOfScope } satisfies DrainDeps,
  };
}

describe('replay scope', () => {
  it('defers a row the runtime must not replay before verifying or processing it', async () => {
    const { stored, process, verify, deps } = depsFor({ status: 200 }, (r) =>
      r.key_families.includes('legacy') ? 'LEGACY_FAMILY' : null
    );

    const summary = await drainPiggyvestWebhookCaptures(deps);

    expect(verify).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'deferred',
        error: 'REPLAY_DEFERRED_LEGACY_FAMILY',
      },
    ]);
    expect(summary).toEqual({
      claimed: 1,
      processed: 0,
      retried: 1,
      needsReview: 0,
    });
    const [line] = alertLines();
    expect(line).toContain('PIGGYVEST_WEBHOOK_REPLAY_DEFERRED');
    expect(line).toContain(stored.capture_id);
    expect(line).not.toContain(key);
    expect(line).not.toContain(stored.signature);
  });

  it('replays the row as before when the scope accepts it', async () => {
    const { stored, process, deps } = depsFor({ status: 200 }, () => null);

    await drainPiggyvestWebhookCaptures(deps);

    expect(process).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual([
      { id: stored.capture_id, state: 'processed', error: null },
    ]);
  });

  it('defers a row whose processing needs a path this runtime does not hold, even on a 2xx', async () => {
    const { stored, deps } = depsFor({
      status: 200,
      outOfScope: 'LEGACY_PATH',
    });

    const summary = await drainPiggyvestWebhookCaptures(deps);

    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'deferred',
        error: 'REPLAY_DEFERRED_LEGACY_PATH',
      },
    ]);
    expect(summary.processed).toBe(0);
    expect(alertLines()[0]).toContain('PIGGYVEST_WEBHOOK_REPLAY_DEFERRED');
  });

  it('parks a conflicting redelivery for review instead of completing it', async () => {
    const { stored, deps } = depsFor({ status: 200, conflict: true });

    const summary = await drainPiggyvestWebhookCaptures(deps);

    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'needs_review',
        error: 'REPLAY_CONFLICT',
      },
    ]);
    expect(summary.needsReview).toBe(1);
    expect(alertLines()[0]).toContain('PIGGYVEST_WEBHOOK_NEEDS_REVIEW');
  });
});
