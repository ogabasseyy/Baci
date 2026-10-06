import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefundedCardCheckoutFixture } from './prefunded-card-checkout.test-fixture';
import { createPrefundedCardCheckoutComposition } from './prefunded-card-checkout-composition';
import { createPrefundedCardCheckoutDatabase } from './prefunded-card-checkout-database';
import { createPrefundedCardCheckoutProvider } from './prefunded-card-checkout-provider';
import { createPrefundedCardCheckoutRuntime } from './prefunded-card-checkout-runtime';
import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';

vi.mock('server-only', () => ({}));
vi.mock('./prefunded-card-checkout-database', () => ({
  createPrefundedCardCheckoutDatabase: vi.fn(),
}));
vi.mock('./prefunded-card-checkout-provider', () => ({
  createPrefundedCardCheckoutProvider: vi.fn(),
}));
vi.mock('./prefunded-card-checkout-runtime', () => ({
  createPrefundedCardCheckoutRuntime: vi.fn(),
}));
vi.mock('./prefunded-card-postgres-executor', () => ({
  createPrefundedCardPostgresExecutor: vi.fn(),
}));
const fixture = prefundedCardCheckoutFixture();
beforeEach(() => {
  vi.clearAllMocks();
});

describe('first-card internal composition', () => {
  it('constructs the two fixed executors without discovering credentials or making requests', () => {
    const customer = vi.fn();
    const verifier = vi.fn();
    vi.mocked(createPrefundedCardPostgresExecutor)
      .mockReturnValueOnce(customer)
      .mockReturnValueOnce(verifier);
    const resolveCustomer = vi.fn();
    const fetchImplementation = vi.fn();
    const now = () => Date.parse('2026-09-26T12:00:00Z');
    createPrefundedCardCheckoutComposition({
      configuration: fixture.configuration,
      resolveCustomer,
      fetchImplementation,
      now,
    });
    expect(createPrefundedCardPostgresExecutor).toHaveBeenNthCalledWith(
      1,
      fixture.configuration.customerDatabase
    );
    expect(createPrefundedCardPostgresExecutor).toHaveBeenNthCalledWith(
      2,
      fixture.configuration.verifierDatabase
    );
    expect(createPrefundedCardCheckoutDatabase).toHaveBeenCalledWith({
      scope: fixture.scope,
      customerExecute: customer,
      verifierExecute: verifier,
      now,
    });
    expect(createPrefundedCardCheckoutProvider).toHaveBeenCalledWith({
      settings: fixture.configuration.provider,
      fetchImplementation,
      now,
    });
    expect(createPrefundedCardCheckoutRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ resolveCustomer, now })
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(customer).not.toHaveBeenCalled();
    expect(verifier).not.toHaveBeenCalled();
  });

  it('rejects invalid configuration before constructing any database executor', () => {
    expect(() =>
      createPrefundedCardCheckoutComposition({
        configuration: {
          ...fixture.configuration,
          scope: { ...fixture.scope, deployment: 'production' },
        },
        resolveCustomer: vi.fn(),
        fetchImplementation: vi.fn(),
      })
    ).toThrow('First-card checkout unavailable');
    expect(createPrefundedCardPostgresExecutor).not.toHaveBeenCalled();
  });
});
