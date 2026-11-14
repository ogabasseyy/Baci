import { describe, expect, it } from 'vitest';
import {
  GENERATED_AT,
  NOW,
  ports,
  snapshot,
  stuck,
} from './daily-reconciliation.test-support';

describe('daily reconciliation test support', () => {
  it('builds stuck rows with distinct ids, references and ages per index', () => {
    const a = stuck(1);
    const b = stuck(2, 'reserved');

    expect(a.operationId).not.toBe(b.operationId);
    expect(a.reference).toBe('synthetic-reference-1');
    expect(a.state).toBe('dispatched');
    expect(b.state).toBe('reserved');
    expect(b.amountKobo).toBe(2000);
    expect(a.ageSeconds).toBeGreaterThan(b.ageSeconds);
  });

  it('builds an empty snapshot that overrides can replace', () => {
    expect(snapshot()).toMatchObject({
      generatedAt: GENERATED_AT,
      stuck: [],
      stuckTotal: 0,
    });
    expect(snapshot({ stuckTotal: 3 }).stuckTotal).toBe(3);
  });

  it('builds ports with deterministic defaults and honours overrides', async () => {
    const loaded = snapshot();
    const base = ports(loaded);

    await expect(base.loadSnapshot()).resolves.toBe(loaded);
    await expect(base.readWalletBalance('w')).resolves.toBe(0);
    expect(base.now()).toBe(NOW);

    const custom = ports(loaded, { now: () => 'fixed' });
    expect(custom.now()).toBe('fixed');
  });
});
