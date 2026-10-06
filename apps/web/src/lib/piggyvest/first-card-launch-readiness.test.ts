import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyFirstCardLaunchReadiness } from './first-card-launch-readiness';
import { prefundedCardCheckoutFixture } from './prefunded-card-checkout.test-fixture';

vi.mock('server-only', () => ({}));
const execute = vi.hoisted(() => vi.fn());
const factory = vi.hoisted(() => vi.fn(() => execute));
vi.mock('./prefunded-card-postgres-executor', () => ({
  createPrefundedCardPostgresExecutor: factory,
}));
const fixture = prefundedCardCheckoutFixture();
const config = {
  deployment: 'staging',
  expiresAt: fixture.scope.expiresAt,
  publicOrigin: 'https://staging.ogabassey.com',
  authOrigin: 'https://staging-auth.ogabassey.com',
  maximumAmountKobo: 10000,
  checkout: fixture.configuration,
  context: {
    environment: 'staging',
    transport: 'tls',
    integrationId: fixture.scope.integrationId,
    merchantId: fixture.scope.merchantId,
    expectedBusinessId: fixture.scope.businessId,
    expectedProjectId: 'staging-test',
    actualProjectId: 'staging-test',
    allowlistedMerchantIds: [fixture.scope.merchantId],
    allowlistedCustomerIds: [fixture.customerIdentity.customerId],
  },
};
const now = Date.parse('2026-09-28T00:00:00Z');

describe('first-card private TLS readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [{ result: true }] });
  });

  it('checks both projected identities using only the fixed read-only readiness query', async () => {
    await expect(verifyFirstCardLaunchReadiness(config, now)).resolves.toEqual({
      status: 'public-private-ready',
      customerTlsVerified: true,
      verifierTlsVerified: true,
      httpStarted: false,
    });
    expect(factory.mock.calls).toEqual([
      [{ ...fixture.configuration.customerDatabase, profile: 'worker' }],
      [{ ...fixture.configuration.verifierDatabase, profile: 'authorizer' }],
    ]);
    expect(execute.mock.calls).toEqual([
      ['SELECT true AS result', []],
      ['SELECT true AS result', []],
    ]);
  });

  it.each([
    { rows: [] },
    { rows: [{ result: false }] },
    { rows: [{ result: true }, { result: true }] },
  ])('does not report readiness for an invalid executor response', async (result) => {
    execute.mockResolvedValue(result);
    await expect(verifyFirstCardLaunchReadiness(config, now)).rejects.toThrow(
      'First-card private readiness refused'
    );
  });

  it('refuses expiry and raised caps without database contact', async () => {
    await expect(
      verifyFirstCardLaunchReadiness(config, Date.parse(config.expiresAt))
    ).rejects.toThrow();
    await expect(
      verifyFirstCardLaunchReadiness(
        { ...config, maximumAmountKobo: 10001 },
        now
      )
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
