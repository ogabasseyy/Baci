import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefundedCardCheckoutPublicSchemas as schemas } from '@/schemas/prefunded-card-checkout-public-runtime';
import { prefundedCardCheckoutFixture } from './prefunded-card-checkout.test-fixture';
import { readPrefundedCardCheckoutPublicRuntime } from './prefunded-card-checkout-public-runtime';
import * as executors from './prefunded-card-postgres-executor';

const mocks = vi.hoisted(() => ({
  capabilityExecute: vi.fn(),
  context: vi.fn(),
  fetch: vi.fn(),
  postgresClient: vi.fn(() => {
    throw new Error('Unexpected database access');
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Client: mocks.postgresClient }));
vi.mock('./prefunded-card-checkout-public-context', () => ({
  resolvePrefundedCardCheckoutPublicContext: mocks.context,
}));

function fixture() {
  const checkout = prefundedCardCheckoutFixture();
  const configuration = {
    deployment: 'staging',
    expiresAt: checkout.scope.expiresAt,
    publicOrigin: 'https://staging.ogabassey.com',
    authOrigin: 'https://staging-auth.ogabassey.com',
    maximumAmountKobo: 250000,
    context: {
      environment: 'staging',
      transport: 'tls',
      integrationId: checkout.scope.integrationId,
      merchantId: checkout.scope.merchantId,
      expectedBusinessId: checkout.scope.businessId,
      expectedProjectId:
        checkout.configuration.customerDatabase.expectedProjectId,
      actualProjectId: checkout.configuration.customerDatabase.actualProjectId,
      allowlistedMerchantIds: [checkout.scope.merchantId],
      allowlistedCustomerIds: [checkout.customerIdentity.customerId],
    },
    checkout: checkout.configuration,
  };
  return {
    checkout,
    configuration,
    options: {
      authOrigin: configuration.authOrigin,
      fetchImplementation: mocks.fetch,
      environment: {
        NODE_ENV: 'test' as const,
        NEXT_PUBLIC_SUPABASE_URL: configuration.authOrigin,
        PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG: JSON.stringify(configuration),
        PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED: 'true',
        PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED: 'true',
      },
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
  vi.spyOn(executors, 'createPrefundedCardPostgresExecutor').mockReturnValue(
    mocks.capabilityExecute
  );
  mocks.context.mockResolvedValue({
    status: 'ready',
    actorId: '00000000-0000-4000-8000-000000000006',
    customerId: '00000000-0000-4000-8000-000000000005',
    email: 'checkout@example.com',
    goalId: '00000000-0000-4000-8000-000000000007',
  });
  mocks.capabilityExecute.mockResolvedValue({
    rows: [
      {
        result: {
          goalId: '00000000-0000-4000-8000-000000000007',
          enabled: true,
          maximumAmountKobo: 200000,
          currency: 'NGN',
        },
      },
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  expect(mocks.postgresClient).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
});

describe('public first-card checkout runtime readiness', () => {
  it('uses owned-goal authentication without financial database access in read-only mode', async () => {
    const { checkout, options } = fixture();
    const runtime = readPrefundedCardCheckoutPublicRuntime({
      ...options,
      environment: {
        ...options.environment,
        PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED: 'false',
      },
    });

    const capability = await runtime
      ?.customer({} as SupabaseClient)
      .capability({
        goalId: checkout.customerRequest.goalId,
      });

    expect(capability).toEqual({
      goalId: checkout.customerRequest.goalId,
      enabled: false,
      maximumAmountKobo: 0,
      currency: 'NGN',
    });
    expect(mocks.context).toHaveBeenCalled();
    expect(mocks.capabilityExecute).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    'false',
    'TRUE',
    '1',
  ])('does not enable mutations for an unapproved activation flag %s', async (flag) => {
    const { checkout, options } = fixture();

    const runtime = readPrefundedCardCheckoutPublicRuntime({
      ...options,
      environment: {
        ...options.environment,
        PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED: flag,
      },
    });

    expect(runtime?.mutationsEnabled).toBe(false);
    const customer = runtime?.customer({} as SupabaseClient);
    await expect(customer?.start(checkout.customerRequest)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    await expect(customer?.refresh(checkout.customerSelection)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.capabilityExecute).not.toHaveBeenCalled();
  });

  it('requires an explicit reviewed financial activation before enabling mutations', () => {
    const { options } = fixture();

    const runtime = readPrefundedCardCheckoutPublicRuntime({
      ...options,
      environment: {
        ...options.environment,
        PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED: 'true',
      },
    });

    expect(runtime?.mutationsEnabled).toBe(true);
  });

  it('rejects the synthetic .invalid email before reserving money or contacting Paystack', async () => {
    const { checkout, options } = fixture();
    mocks.context.mockResolvedValue({
      status: 'ready',
      ...checkout.customerIdentity,
      email: 'staging-phone@baci.invalid',
    });
    const runtime = readPrefundedCardCheckoutPublicRuntime(options);

    await expect(
      runtime?.customer({} as SupabaseClient).start(checkout.customerRequest)
    ).rejects.toThrow('First-card checkout unavailable');
    expect(mocks.capabilityExecute).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('keeps verification available for a pending attempt with the old synthetic email', async () => {
    const { checkout, options } = fixture();
    mocks.context.mockResolvedValue({
      status: 'ready',
      ...checkout.customerIdentity,
      email: 'staging-phone@baci.invalid',
    });
    mocks.capabilityExecute.mockResolvedValue({
      rows: [
        {
          result: {
            intent: { ...checkout.intent, email: 'staging-phone@baci.invalid' },
            phase: 'pending',
            session: null,
            operationId: null,
          },
        },
      ],
    });
    mocks.fetch.mockRejectedValue(new Error('Verification unavailable'));
    const runtime = readPrefundedCardCheckoutPublicRuntime(options);

    await expect(
      runtime
        ?.customer({} as SupabaseClient)
        .refresh(checkout.customerSelection)
    ).resolves.toMatchObject({
      status: 'pending',
      intentId: checkout.intent.intentId,
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(
      `https://api.paystack.co/transaction/verify/${checkout.intent.reference}`,
      expect.objectContaining({ method: 'GET' })
    );
    mocks.fetch.mockClear();
  });

  it('constructs the real checkout factory and executors after strict public parsing without injecting profiles', () => {
    vi.mocked(executors.createPrefundedCardPostgresExecutor).mockRestore();
    const { configuration, options } = fixture();

    const parsed = schemas.configuration.parse(configuration);
    const reparsed = schemas.configuration.parse(parsed);
    const runtime = readPrefundedCardCheckoutPublicRuntime(options);
    const customer = runtime?.customer({} as SupabaseClient);

    expect(parsed).toEqual(configuration);
    expect(reparsed).toEqual(parsed);
    expect(parsed.checkout.customerDatabase.profile).toBe('checkout_customer');
    expect(parsed.checkout.verifierDatabase.profile).toBe(
      'checkout_authorizer'
    );
    expect(runtime?.publicOrigin).toBe(configuration.publicOrigin);
    expect(customer).toEqual({
      capability: expect.any(Function),
      refresh: expect.any(Function),
      start: expect.any(Function),
    });
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.capabilityExecute).not.toHaveBeenCalled();
  });

  it.each([
    ['customerDatabase', 'worker'],
    ['customerDatabase', 'customer'],
    ['verifierDatabase', 'authorizer'],
    ['customerDatabase', undefined],
    ['verifierDatabase', undefined],
  ] as const)('rejects an external %s profile of %s rather than overriding it', (database, profile) => {
    const { configuration, options } = fixture();
    const invalid = {
      ...configuration,
      checkout: {
        ...configuration.checkout,
        [database]: { ...configuration.checkout[database], profile },
      },
    };
    options.environment.PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG =
      JSON.stringify(invalid);

    expect(schemas.configuration.safeParse(invalid).success).toBe(false);
    expect(() => readPrefundedCardCheckoutPublicRuntime(options)).toThrow(
      'First-card checkout unavailable'
    );
    expect(
      executors.createPrefundedCardPostgresExecutor
    ).not.toHaveBeenCalled();
  });

  it('rejects unknown external configuration fields instead of stripping them', () => {
    const { configuration, options } = fixture();
    for (const invalid of [
      { ...configuration, profile: 'worker' },
      {
        ...configuration,
        checkout: { ...configuration.checkout, profile: 'worker' },
      },
      {
        ...configuration,
        checkout: {
          ...configuration.checkout,
          customerDatabase: {
            ...configuration.checkout.customerDatabase,
            unknown: true,
          },
        },
      },
    ]) {
      options.environment.PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG =
        JSON.stringify(invalid);

      expect(schemas.configuration.safeParse(invalid).success).toBe(false);
      expect(() => readPrefundedCardCheckoutPublicRuntime(options)).toThrow(
        'First-card checkout unavailable'
      );
    }
    expect(
      executors.createPrefundedCardPostgresExecutor
    ).not.toHaveBeenCalled();
  });

  it('does not enable from configuration alone and returns the live restricted capability', async () => {
    const { checkout, options } = fixture();
    const runtime = readPrefundedCardCheckoutPublicRuntime(options);
    const capability = await runtime
      ?.customer({} as SupabaseClient)
      .capability({ goalId: checkout.customerIdentity.goalId });

    expect(capability).toEqual({
      goalId: checkout.customerIdentity.goalId,
      enabled: true,
      maximumAmountKobo: 200000,
      currency: 'NGN',
    });
    expect(executors.createPrefundedCardPostgresExecutor).toHaveBeenCalledWith(
      checkout.configuration.customerDatabase
    );
    expect(mocks.capabilityExecute).toHaveBeenCalledWith(
      'SELECT prefunded_card.checkout_capability($1::jsonb,$2::uuid,$3::uuid,$4::uuid,$5::bigint) AS result',
      [
        JSON.stringify(checkout.scope),
        checkout.customerIdentity.customerId,
        checkout.customerIdentity.actorId,
        checkout.customerIdentity.goalId,
        '250000',
      ]
    );
  });

  it('rejects a POST amount above the configured maximum before reservation', async () => {
    const { checkout, options } = fixture();
    const runtime = readPrefundedCardCheckoutPublicRuntime(options);

    await expect(
      runtime?.customer({} as SupabaseClient).start({
        ...checkout.customerRequest,
        amountKobo: 250001,
      })
    ).rejects.toThrow('First-card checkout unavailable');
    expect(mocks.capabilityExecute).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
  });
});
