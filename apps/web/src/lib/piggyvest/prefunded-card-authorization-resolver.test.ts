import { describe, expect, it, vi } from 'vitest';
import { createPrefundedCardAuthorizationResolver } from './prefunded-card-authorization-resolver';
import { createPrefundedCardProvider } from './prefunded-card-provider';
import { prefundedCardProviderTestFixture } from './prefunded-card-provider.test-fixture';

vi.mock('server-only', () => ({}));

const identity = {
  savedMethodId: '60000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
};
const scope = {
  treasuryBindingId: '50000000-0000-4000-8000-000000000001',
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: identity.merchantId,
  systemIdentifier: '1234567890123456789',
};
const transactionId = '70000000-0000-4000-8000-000000000001';
const savedMethod = {
  ...identity,
  email: 'original@example.test',
  authorizationCode: 'AUTH_synthetic_original',
  paystackCustomerCode: 'CUS_synthetic_original',
  domain: 'test',
  reusable: true,
  active: true,
};
const errorMessage = 'Prefunded card authorization unavailable';

describe('prefunded card authorization resolver', () => {
  it('reads the independently stored authorization using only pinned SQL parameters', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ rows: [{ result: savedMethod }] });
    const resolver = createPrefundedCardAuthorizationResolver({
      execute,
      scope,
    });

    await expect(resolver.resolveSavedMethod(identity)).resolves.toEqual(
      savedMethod
    );
    expect(execute).toHaveBeenCalledWith(
      'SELECT prefunded_card.read_authorization($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text) AS result',
      [
        scope.treasuryBindingId,
        scope.integrationId,
        identity.merchantId,
        identity.customerId,
        identity.savedMethodId,
        scope.systemIdentifier,
      ]
    );
  });

  it('retains the original authorization for historical verification after revocation', async () => {
    const revoked = { ...savedMethod, active: false, reusable: false };
    const execute = vi.fn().mockResolvedValue({ rows: [{ result: revoked }] });
    const resolver = createPrefundedCardAuthorizationResolver({
      execute,
      scope,
    });

    await expect(resolver.resolveSavedMethod(identity)).resolves.toEqual(
      revoked
    );
  });

  it('connects to the real provider: revoked cards cannot send but original charges can verify', async () => {
    const fixture = prefundedCardProviderTestFixture;
    const execute = vi.fn().mockResolvedValue({
      rows: [{ result: { ...fixture.savedMethod, active: false } }],
    });
    const resolver = createPrefundedCardAuthorizationResolver({
      execute,
      scope: {
        treasuryBindingId: fixture.claim.treasuryBindingId,
        integrationId: fixture.claim.integrationId,
        merchantId: fixture.claim.merchantId,
        systemIdentifier: scope.systemIdentifier,
      },
    });
    const fetchImplementation = vi.fn().mockResolvedValue(
      fixture.jsonResponse({
        status: true,
        data: {
          id: 123,
          status: 'success',
          domain: 'test',
          reference: fixture.claim.collectionReference,
          amount: fixture.claim.amountKobo,
          currency: fixture.claim.currency,
          customer: {
            email: fixture.savedMethod.email,
            customer_code: fixture.savedMethod.paystackCustomerCode,
          },
          authorization: {
            authorization_code: fixture.savedMethod.authorizationCode,
          },
        },
      })
    );
    const provider = createPrefundedCardProvider({
      settings: fixture.providerSettings,
      fetchImplementation,
      resolveSavedMethod: resolver.resolveSavedMethod,
    });

    await expect(provider.submitCollection(fixture.claim)).rejects.toThrow();
    expect(fetchImplementation).not.toHaveBeenCalled();
    await expect(
      provider.verifyCollection(fixture.claim)
    ).resolves.toMatchObject({ outcome: 'verified_success' });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation.mock.calls[0][1].method).toBe('GET');
  });

  it.each([
    { ...identity, customerId: 'invalid' },
    { ...identity, merchantId: '10000000-0000-4000-8000-000000000002' },
    { ...identity, authorizationCode: 'AUTH_untrusted' },
  ])('rejects invalid or cross-scope input before database access', async (input) => {
    const execute = vi.fn();
    const resolver = createPrefundedCardAuthorizationResolver({
      execute,
      scope,
    });
    await expect(resolver.resolveSavedMethod(input)).rejects.toThrow(
      errorMessage
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { ...savedMethod, customerId: '20000000-0000-4000-8000-000000000002' },
    { ...savedMethod, merchantId: '10000000-0000-4000-8000-000000000002' },
    { ...savedMethod, savedMethodId: '60000000-0000-4000-8000-000000000002' },
    { ...savedMethod, domain: 'live' },
    { ...savedMethod, domain: undefined },
    { ...savedMethod, active: undefined },
    { ...savedMethod, authorizationCode: ' AUTH_sensitive ' },
    { ...savedMethod, paystackCustomerCode: '' },
  ])('rejects untrusted database identity or domain instead of echoing the request', async (result) => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ result }] });
    const resolver = createPrefundedCardAuthorizationResolver({
      execute,
      scope,
    });
    await expect(resolver.resolveSavedMethod(identity)).rejects.toThrow(
      errorMessage
    );
  });

  it.each([
    { rows: [] },
    { rows: [{ result: savedMethod }, { result: savedMethod }] },
    { rows: [{ result: null }] },
  ])('rejects absent, duplicate or null database rows', async ({ rows }) => {
    const execute = vi.fn().mockResolvedValue({ rows });
    const resolver = createPrefundedCardAuthorizationResolver({
      execute,
      scope,
    });
    await expect(resolver.resolveSavedMethod(identity)).rejects.toThrow(
      errorMessage
    );
  });

  it('redacts provider secrets from database failures without logging them', async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new Error('AUTH_sensitive original@example.test'));
    const logger = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const resolver = createPrefundedCardAuthorizationResolver({
        execute,
        scope,
      });
      const failure = await resolver
        .resolveSavedMethod(identity)
        .catch((error: unknown) => error);
      expect(failure).toEqual(new Error(errorMessage));
      expect(logger).not.toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });

  it('cannot provision from stored transaction fields without independent verification', async () => {
    const execute = vi.fn();
    const resolver = createPrefundedCardAuthorizationResolver({
      execute,
      scope,
    });
    await expect(
      resolver.provision({ ...identity, transactionId })
    ).rejects.toThrow(errorMessage);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses caller-supplied authorization proof or secrets before provisioning', async () => {
    const execute = vi.fn();
    const fetchImplementation = vi.fn();
    const resolver = createPrefundedCardAuthorizationResolver({
      execute,
      scope,
      verification: {
        paystackSecret: 'sk_test_synthetic',
        fetchImplementation,
      },
    });
    await expect(
      resolver.provision({ ...identity, transactionId, domain: 'test' })
    ).rejects.toThrow(errorMessage);
    expect(execute).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('redacts configuration validation failures', () => {
    expect(() =>
      createPrefundedCardAuthorizationResolver({
        execute: vi.fn(),
        scope: { ...scope, systemIdentifier: 'AUTH_sensitive' },
      })
    ).toThrow(errorMessage);
  });
});
