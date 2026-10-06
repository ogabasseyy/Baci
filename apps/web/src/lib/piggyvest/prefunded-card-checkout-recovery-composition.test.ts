import { describe, expect, it, vi } from 'vitest';
import { prefundedCardCheckoutFixture } from './prefunded-card-checkout.test-fixture';
import { createPrefundedCardCheckoutRecoveryComposition } from './prefunded-card-checkout-recovery-composition';

vi.mock('server-only', () => ({}));

const execute = vi.fn();
const provider = { verify: vi.fn() };
const recovery = { run: vi.fn() };

vi.mock('./prefunded-card-postgres-executor', () => ({
  createPrefundedCardPostgresExecutor: () => execute,
}));
vi.mock('./prefunded-card-checkout-provider', () => ({
  createPrefundedCardCheckoutProvider: () => provider,
}));
vi.mock('./prefunded-card-checkout-recovery', () => ({
  createPrefundedCardCheckoutRecovery: (input: unknown) => {
    recovery.run = vi.fn();
    return { ...recovery, input };
  },
}));

describe('first-card checkout recovery composition', () => {
  it('constructs only the authorizer reader, verifier, and promotion store', () => {
    const fixture = prefundedCardCheckoutFixture();
    const configuration = {
      scope: fixture.scope,
      authorizerDatabase: fixture.configuration.verifierDatabase,
      provider: fixture.configuration.provider,
    };

    const composed = createPrefundedCardCheckoutRecoveryComposition({
      configuration,
      fetchImplementation: vi.fn() as unknown as typeof fetch,
    });

    expect(composed).toHaveProperty('run');
    expect(typeof composed.run).toBe('function');
  });
});
