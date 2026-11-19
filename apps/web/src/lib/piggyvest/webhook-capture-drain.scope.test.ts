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
  type ResolvedCall,
  row,
  schemaValidInflow,
  sign,
} from './webhook-capture-drain.test-support';

const key = deterministicTestKey('drain-scope');
const inflow = schemaValidInflow('evt-scope-1');
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
  it('sets a row the runtime must not replay aside for review, before verifying or processing it', async () => {
    const { stored, process, verify, deps } = depsFor({ status: 200 }, (r) =>
      r.key_families.includes('legacy') ? 'LEGACY_FAMILY' : null
    );

    const summary = await drainPiggyvestWebhookCaptures(deps);

    expect(verify).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
    // Out of the claimable set, so such rows can never crowd out work this
    // runtime can finish; a successful provider redelivery still closes it.
    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'needs_review',
        error: 'REPLAY_OUT_OF_SCOPE_LEGACY_FAMILY',
      },
    ]);
    expect(summary).toEqual({
      claimed: 1,
      processed: 0,
      retried: 0,
      needsReview: 1,
    });
    const [line] = alertLines();
    expect(line).toContain('PIGGYVEST_WEBHOOK_REPLAY_DEFERRED');
    expect(line).toContain(stored.capture_id);
    expect(line).not.toContain(key);
    expect(line).not.toContain(stored.signature);
  });

  it('parks an out-of-scope row whose body the parser rejects as content-quarantined', async () => {
    // The receiver acknowledges such a delivery and leaves the row for the
    // drain to park; setting it aside under the scope code would hide why.
    const unknown = JSON.stringify({
      eventId: 'evt-unknown-1',
      eventType: 'provider.new-event.success',
      eventData: { id: 'x' },
    });
    const stored = row(unknown, sign(key, unknown));
    const process = vi.fn();
    const deps: DrainDeps = {
      ...drainDeps(() => ({ env, resolved }), [[stored]], process),
      outOfScope: () => 'LEGACY_FAMILY',
    };

    const summary = await drainPiggyvestWebhookCaptures(deps);

    expect(process).not.toHaveBeenCalled();
    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'needs_review',
        error: 'REPLAY_CONTENT_QUARANTINED',
      },
    ]);
    expect(summary.needsReview).toBe(1);
    expect(alertLines()[0]).toContain('PIGGYVEST_WEBHOOK_NEEDS_REVIEW');
  });

  it('settles every out-of-scope row of a batch before processing any other row', async () => {
    // A row only the legacy path can finish may be completed inline by a
    // provider redelivery while it is claimed; settling it first keeps
    // that window to the claim itself.
    const inScope = row(inflow, sign(key, inflow), { key_families: ['bank'] });
    const outOfScope = row(inflow, sign(key, inflow));
    const settledWhenProcessing: string[][] = [];
    const process = vi.fn(async () => {
      settledWhenProcessing.push(resolved.map((call) => call.id));
      return { status: 200 };
    });
    const deps: DrainDeps = {
      ...drainDeps(() => ({ env, resolved }), [[inScope, outOfScope]], process),
      verify: () => ({
        status: 'verified',
        secret: key,
        families: ['bank'],
        keyVersion: 'k-0123456789abcdef',
        keyStatus: 'current',
      }),
      outOfScope: (r) =>
        r.key_families.includes('legacy') ? 'LEGACY_FAMILY' : null,
    };

    await drainPiggyvestWebhookCaptures(deps);

    expect(settledWhenProcessing).toEqual([[outOfScope.capture_id]]);
    expect(resolved.map((call) => [call.id, call.state])).toEqual([
      [outOfScope.capture_id, 'needs_review'],
      [inScope.capture_id, 'processed'],
    ]);
  });

  it('replays the row as before when the scope accepts it', async () => {
    const { stored, process, deps } = depsFor({ status: 200 }, () => null);

    await drainPiggyvestWebhookCaptures(deps);

    expect(process).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual([
      { id: stored.capture_id, state: 'processed', error: null },
    ]);
  });

  it('sets aside a row whose processing needs a path this runtime does not hold, even on a 2xx', async () => {
    const { stored, deps } = depsFor({
      status: 200,
      outOfScope: 'LEGACY_PATH',
    });

    const summary = await drainPiggyvestWebhookCaptures(deps);

    expect(resolved).toEqual([
      {
        id: stored.capture_id,
        state: 'needs_review',
        error: 'REPLAY_OUT_OF_SCOPE_LEGACY_PATH',
      },
    ]);
    expect(summary).toMatchObject({ processed: 0, needsReview: 1 });
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
