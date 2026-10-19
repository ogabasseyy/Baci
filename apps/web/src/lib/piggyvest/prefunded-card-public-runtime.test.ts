import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFUNDED_CARD_CUSTOMER_STATEMENTS as statements } from './prefunded-card-customer-statements';
import { readPrefundedCardPublicRuntime } from './prefunded-card-public-runtime';
import { prefundedCardPublicRuntimeFixture } from './prefunded-card-public-runtime.test-fixture';

const mocks = vi.hoisted(() => ({ construct: vi.fn(), execute: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./prefunded-card-postgres-executor', () => ({
  createPrefundedCardPostgresExecutor: mocks.construct,
}));

function fixture() {
  const configuration = prefundedCardPublicRuntimeFixture();
  return {
    configuration,
    options: {
      authOrigin: configuration.authOrigin,
      environment: {
        NODE_ENV: 'test' as const,
        PREFUNDED_CARD_PUBLIC_ENABLED: 'true',
        PREFUNDED_CARD_PUBLIC_CONFIG: JSON.stringify(configuration),
        NEXT_PUBLIC_SUPABASE_URL: configuration.authOrigin,
      },
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
  mocks.construct.mockReturnValue(mocks.execute);
  mocks.execute.mockResolvedValue({ rows: [] });
});

afterEach(() => vi.useRealTimers());

describe('public card runtime construction', () => {
  it('defaults off without reading malformed configuration or constructing SQL', () => {
    const { options } = fixture();
    options.environment.PREFUNDED_CARD_PUBLIC_ENABLED = 'false';
    options.environment.PREFUNDED_CARD_PUBLIC_CONFIG = '{';
    expect(readPrefundedCardPublicRuntime(options)).toBeNull();
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it.each([
    'authOrigin',
    'environment',
  ])('refuses mismatched %s auth configuration', (source) => {
    const { options } = fixture();
    if (source === 'authOrigin')
      options.authOrigin = 'https://other.example.test';
    else
      options.environment.NEXT_PUBLIC_SUPABASE_URL =
        'https://other.example.test';
    expect(() => readPrefundedCardPublicRuntime(options)).toThrow(
      'Savings card contribution unavailable'
    );
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it('constructs only customer SQL without provider calls and fences trusted scope', async () => {
    const { options, configuration } = fixture();
    const runtime = readPrefundedCardPublicRuntime(options);
    expect(runtime).not.toBeNull();
    expect(mocks.construct).toHaveBeenCalledWith(configuration.database);
    expect(mocks.execute).not.toHaveBeenCalled();
    const parameters = [
      configuration.context.integrationId,
      configuration.context.merchantId,
      configuration.context.allowlistedCustomerIds[0],
      '30000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001',
      configuration.context.expectedBusinessId,
      configuration.database.expectedSystemId,
      '{}',
    ];
    await runtime?.card.execute(statements.status, parameters);
    expect(mocks.execute).toHaveBeenCalledWith(statements.status, parameters);
    for (const index of [0, 1, 2, 5, 6]) {
      const changed = [...parameters];
      changed[index] = 'other';
      await expect(
        runtime?.card.execute(statements.status, changed)
      ).rejects.toThrow('unavailable');
    }
    await expect(
      runtime?.card.execute('SELECT prefunded_card.claim_due()', parameters)
    ).rejects.toThrow('unavailable');
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it('redacts invalid configuration and refuses oversized configuration', () => {
    const { options } = fixture();
    options.environment.PREFUNDED_CARD_PUBLIC_CONFIG = 'private-secret';
    expect(() => readPrefundedCardPublicRuntime(options)).toThrow(
      'Savings card contribution unavailable'
    );
    options.environment.PREFUNDED_CARD_PUBLIC_CONFIG = ' '.repeat(65_537);
    expect(() => readPrefundedCardPublicRuntime(options)).toThrow(
      'Savings card contribution unavailable'
    );
  });

  it('refuses construction and a previously constructed executor at the fixed deadline', async () => {
    const { options, configuration } = fixture();
    const runtime = readPrefundedCardPublicRuntime(options);
    vi.setSystemTime(new Date(configuration.expiresAt));
    expect(() => readPrefundedCardPublicRuntime(options)).toThrow(
      'Savings card contribution unavailable'
    );
    await expect(
      runtime?.card.execute(statements.status, [
        configuration.context.integrationId,
        configuration.context.merchantId,
        configuration.context.allowlistedCustomerIds[0],
        '30000000-0000-4000-8000-000000000001',
        '90000000-0000-4000-8000-000000000001',
        configuration.context.expectedBusinessId,
        configuration.database.expectedSystemId,
        '{}',
      ])
    ).rejects.toThrow('unavailable');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
