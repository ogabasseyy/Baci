import { describe, expect, it } from 'vitest';
import {
  env,
  INTEGRATION,
  makeDeps,
  runtime,
  snapshot,
} from './daily-reconciliation-runtime.test-support';

describe('daily reconciliation runtime test support', () => {
  it('exposes a synthetic enabled env and a runtime bound to one integration', () => {
    expect(env.PIGGYVEST_RECONCILIATION_ENABLED).toBe('true');
    expect(runtime.configuration.integrationId).toBe(INTEGRATION);
    expect(runtime.reconciliationConfiguration.integrationId).toBe(INTEGRATION);
    expect(runtime.providerToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds an empty snapshot that overrides can replace', () => {
    expect(snapshot().stuck).toEqual([]);
    expect(snapshot({ walletsTotal: 2 }).walletsTotal).toBe(2);
  });

  it('builds deps whose executor returns the empty snapshot and whose clock is fixed', async () => {
    const { deps, execute } = makeDeps();

    await expect(execute()).resolves.toEqual({
      rows: [{ result: snapshot() }],
    });
    expect(deps.now()).toBe('2026-11-03T00:30:00.000Z');
    expect(deps.nowMs()).toBe(0);
    await expect(deps.sendEmail({} as never)).resolves.toEqual({
      success: true,
    });
  });

  it('lets callers override individual deps', () => {
    const { deps } = makeDeps({ nowMs: () => 42 });
    expect(deps.nowMs()).toBe(42);
  });
});
