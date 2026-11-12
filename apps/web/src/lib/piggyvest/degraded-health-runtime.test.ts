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

function deps(over: Partial<DegradedHealthDeps> & { stuck?: number } = {}) {
  const emitAlert = vi.fn();
  const execute = vi.fn(async () => ({ rows: snapshot(over.stuck ?? 0) }));
  const value = {
    readRuntime: vi.fn(() => ({
      configuration: { environment: 'production', integrationId: 'i1' },
      reconciliationConfiguration: {},
    })),
    createExecutor: vi.fn(() => execute),
    readStalledGoalWallets: vi.fn(async () => 0),
    emitAlert,
    nowMs: () => 1_800_000_000_000,
    ...over,
  } as unknown as DegradedHealthDeps;
  return { value, emitAlert, execute };
}

describe('runPiggyvestDegradedHealth', () => {
  beforeEach(resetDegradedHealthClaims);

  it('does nothing and reads nothing while the switch is off', async () => {
    const d = deps({ stuck: 9 });
    const result = await runPiggyvestDegradedHealth({
      env: {},
      deps: d.value,
    });
    expect(result).toEqual({ status: 'disabled' });
    expect(d.execute).not.toHaveBeenCalled();
    expect(d.emitAlert).not.toHaveBeenCalled();
  });

  it('pages once per hour per reason with a counts-only detail', async () => {
    const d = deps({ stuck: 4, readStalledGoalWallets: async () => 2 });
    const env = { PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' };
    const first = await runPiggyvestDegradedHealth({ env, deps: d.value });
    const second = await runPiggyvestDegradedHealth({ env, deps: d.value });
    expect(first).toMatchObject({ alerts: 2, paged: 2 });
    expect(second).toMatchObject({ alerts: 2, paged: 0 });
    expect(d.emitAlert).toHaveBeenCalledTimes(2);
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
    const env = { PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' };
    await runPiggyvestDegradedHealth({ env, deps: d.value });
    now += 3_600_000;
    await runPiggyvestDegradedHealth({ env, deps: d.value });
    expect(d.emitAlert).toHaveBeenCalledTimes(2);
  });

  it('does not page when the database read fails', async () => {
    const d = deps({
      createExecutor: vi.fn(() => async () => {
        throw new Error('down');
      }) as never,
    });
    const result = await runPiggyvestDegradedHealth({
      env: { PIGGYVEST_DEGRADED_ALERTS_ENABLED: 'true' },
      deps: d.value,
    });
    expect(result).toMatchObject({ indeterminateTransfers: null, paged: 0 });
  });
});
