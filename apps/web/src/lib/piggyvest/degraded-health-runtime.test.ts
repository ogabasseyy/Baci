import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  type DegradedHealthDeps,
  resetDegradedHealthClaims,
  runPiggyvestDegradedHealth,
} from './degraded-health-runtime';

const snapshot = (stuckTotal: number) => [
  {
    result: {
      generatedAt: '2026-11-12T10:00:00+00:00',
      staleAfterSeconds: 600,
      businessId: 'biz_1',
      stuck: [],
      stuckTotal,
      stuckDeferred: stuckTotal,
      wallets: [],
      walletsTotal: 0,
      walletsDeferred: 0,
    },
  },
];

const goalHealth = (stalledGoalWallets: number) => [
  {
    result: {
      generatedAt: '2026-11-12T10:00:00+00:00',
      staleAfterSeconds: 600,
      stalledGoalWallets,
    },
  },
];

function deps(
  over: Partial<DegradedHealthDeps> & { stuck?: number; stalled?: number } = {}
) {
  const emitAlert = vi.fn();
  const execute = vi.fn(async (statement: string) => ({
    rows: statement.includes('read_goal_wallet_setup_health')
      ? goalHealth(over.stalled ?? 0)
      : snapshot(over.stuck ?? 0),
  }));
  const value = {
    readRuntime: vi.fn(() => ({
      configuration: { environment: 'production', integrationId: 'i1' },
      reconciliationConfiguration: {},
    })),
    createExecutor: vi.fn(() => execute),
    emitAlert,
    nowMs: () => 1_800_000_000_000,
    claimShared: vi.fn(async () => null),
    ...over,
  } as unknown as DegradedHealthDeps;
  return { value, emitAlert, execute };
}

/** A test environment: only the variables a case sets. */
const testEnv = (values: Record<string, string> = {}) =>
  values as unknown as NodeJS.ProcessEnv;

describe('runPiggyvestDegradedHealth', () => {
  beforeEach(resetDegradedHealthClaims);

  it('does nothing and reads nothing while the switch is off', async () => {
    const d = deps({ stuck: 9 });
    const result = await runPiggyvestDegradedHealth({
      env: testEnv(),
      deps: d.value,
    });
    expect(result).toEqual({ status: 'disabled' });
    expect(d.execute).not.toHaveBeenCalled();
    expect(d.emitAlert).not.toHaveBeenCalled();
  });

  it('pages once per hour per reason with a counts-only detail', async () => {
    const d = deps({ stuck: 4 });
    const env = testEnv({ PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' });
    const first = await runPiggyvestDegradedHealth({ env, deps: d.value });
    const second = await runPiggyvestDegradedHealth({ env, deps: d.value });
    expect(first).toMatchObject({ alerts: 1, paged: 1 });
    expect(second).toMatchObject({ alerts: 1, paged: 0 });
    expect(d.emitAlert).toHaveBeenCalledTimes(1);
    for (const [code, detail] of d.emitAlert.mock.calls) {
      expect(code).toBe('PIGGYVEST_DEGRADED');
      expect(Object.keys(detail).sort()).toEqual([
        'attempts',
        'operationId',
        'reason',
      ]);
      expect(JSON.stringify(detail)).not.toMatch(/biz_1|@|\d{7,}/);
    }
  });

  it('pages again in the next hour', async () => {
    let now = 1_800_000_000_000;
    const d = deps({ stuck: 3, nowMs: () => now });
    const env = testEnv({ PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' });
    await runPiggyvestDegradedHealth({ env, deps: d.value });
    now += 3_600_000;
    await runPiggyvestDegradedHealth({ env, deps: d.value });
    expect(d.emitAlert).toHaveBeenCalledTimes(2);
  });

  it('bugfix: an early top-of-hour run without Redis pages for the coming hour', async () => {
    const hour = 1_800_000_000_000;
    let now = hour + 60_000; // 10:01 style: pages for this hour
    const d = deps({ stuck: 3, nowMs: () => now });
    const env = testEnv({ PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' });
    await runPiggyvestDegradedHealth({ env, deps: d.value });
    now = hour + 3_600_000 - 60_000; // 10:59: the next hour's run, early
    await runPiggyvestDegradedHealth({ env, deps: d.value });
    expect(d.emitAlert).toHaveBeenCalledTimes(2);
  });

  it('bugfix: waits for the alert send before returning', async () => {
    let finished = false;
    const d = deps({ stuck: 3 });
    d.value.emitAlert = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
      return true;
    });
    const env = testEnv({ PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' });
    await runPiggyvestDegradedHealth({ env, deps: d.value });
    expect(finished).toBe(true);
  });

  it('pages stalled goal-wallet setups once per hour, counts only', async () => {
    const d = deps({ stalled: 3 });
    const env = testEnv({ PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' });
    const first = await runPiggyvestDegradedHealth({ env, deps: d.value });
    const second = await runPiggyvestDegradedHealth({ env, deps: d.value });
    expect(first).toMatchObject({
      indeterminateTransfers: 0,
      stalledGoalWallets: 3,
      readFailed: false,
      alerts: 1,
      paged: 1,
    });
    expect(second).toMatchObject({ alerts: 1, paged: 0 });
    expect(d.emitAlert).toHaveBeenCalledTimes(1);
    expect(d.emitAlert).toHaveBeenCalledWith('PIGGYVEST_DEGRADED', {
      reason: 'goal_wallet_setup_stalled',
      attempts: 3,
      operationId: 'degraded-goal_wallet_setup_stalled-500000',
    });
  });

  it('pages transfers and goal wallets as separate reasons', async () => {
    const d = deps({ stuck: 4, stalled: 5 });
    const env = testEnv({ PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' });
    const result = await runPiggyvestDegradedHealth({ env, deps: d.value });
    expect(result).toMatchObject({ alerts: 2, paged: 2 });
  });

  it('stays quiet below the goal-wallet threshold', async () => {
    const d = deps({ stalled: 2 });
    const env = testEnv({ PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' });
    expect(
      await runPiggyvestDegradedHealth({ env, deps: d.value })
    ).toMatchObject({
      alerts: 0,
      paged: 0,
    });
    expect(d.emitAlert).not.toHaveBeenCalled();
  });

  describe('bugfix: a failed goal-wallet read looked healthy', () => {
    it('reports a failed goal-wallet read while transfers still read', async () => {
      const d = deps({
        stuck: 4,
        createExecutor: vi.fn(() => async (statement: string) => {
          if (statement.includes('read_goal_wallet_setup_health'))
            throw new Error('down');
          return { rows: snapshot(4) };
        }) as never,
      });
      const env = testEnv({ PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' });
      const result = await runPiggyvestDegradedHealth({ env, deps: d.value });
      expect(result).toMatchObject({
        indeterminateTransfers: 4,
        stalledGoalWallets: null,
        readFailed: true,
        alerts: 1,
        paged: 2,
      });
      expect(d.emitAlert).toHaveBeenCalledWith(
        'PIGGYVEST_DEGRADED',
        expect.objectContaining({ reason: 'health_read_failed' })
      );
    });

    it('treats a malformed goal-wallet result as a failed read', async () => {
      const d = deps({
        createExecutor: vi.fn(() => async (statement: string) => ({
          rows: statement.includes('read_goal_wallet_setup_health')
            ? [{ result: { stalledGoalWallets: 'many' } }]
            : snapshot(0),
        })) as never,
      });
      const env = testEnv({ PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' });
      const result = await runPiggyvestDegradedHealth({ env, deps: d.value });
      expect(result).toMatchObject({
        stalledGoalWallets: null,
        readFailed: true,
      });
    });
  });

  describe('bugfix: a failed health read looked healthy', () => {
    it('reports the failed read and pages it once per hour', async () => {
      const d = deps({
        createExecutor: vi.fn(() => async () => {
          throw new Error('down');
        }) as never,
      });
      const env = testEnv({ PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' });
      const first = await runPiggyvestDegradedHealth({ env, deps: d.value });
      const second = await runPiggyvestDegradedHealth({ env, deps: d.value });
      expect(first).toMatchObject({
        indeterminateTransfers: null,
        stalledGoalWallets: null,
        readFailed: true,
        paged: 1,
      });
      expect(second).toMatchObject({ readFailed: true, paged: 0 });
      expect(d.emitAlert).toHaveBeenCalledTimes(1);
      expect(d.emitAlert).toHaveBeenCalledWith(
        'PIGGYVEST_DEGRADED',
        expect.objectContaining({ reason: 'health_read_failed' })
      );
    });
  });

  describe('bugfix: several server copies paged the same hour', () => {
    it('pages once across copies that share the claim', async () => {
      const taken = new Set<string>();
      const claimShared = vi.fn(async (key: string) => {
        if (taken.has(key)) return false;
        taken.add(key);
        return true;
      });
      const env = testEnv({ PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' });
      const first = deps({ stuck: 4, claimShared });
      await runPiggyvestDegradedHealth({ env, deps: first.value });
      // A second copy has its own memory but the same shared claim.
      resetDegradedHealthClaims();
      const second = deps({ stuck: 4, claimShared });
      await runPiggyvestDegradedHealth({ env, deps: second.value });
      expect(first.emitAlert).toHaveBeenCalledTimes(1);
      expect(second.emitAlert).not.toHaveBeenCalled();
    });
  });
});
