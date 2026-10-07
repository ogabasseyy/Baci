import { vi } from 'vitest';
import { prefundedCardProviderTestFixture as fixture } from './prefunded-card-provider.test-fixture';

export function prefundedCardCompositionTestOptions() {
  const database = (login: string) => ({
    environment: 'staging',
    transport: 'local_test',
    socketDirectory:
      '/private/tmp/baci-prefunded-card-executor.synthetic/socket',
    database: 'prefunded_card_local',
    expectedDatabase: 'prefunded_card_local',
    expectedSystemId: '123',
    port: 55461,
    login,
    expectedLogin: login,
    password: 'synthetic-local-only',
  });
  return {
    configuration: {
      worker: {
        environment: 'staging',
        integrationId: fixture.claim.integrationId,
        merchantId: fixture.claim.merchantId,
        treasuryBindingId: fixture.claim.treasuryBindingId,
        businessId: fixture.claim.businessId,
        expectedSystemId: '123',
      },
      provider: structuredClone(fixture.providerSettings),
      evidence: {
        integrationId: fixture.claim.integrationId,
        systemIdentifier: '123',
        webhookSecret: 'synthetic-webhook-secret',
        piggyvest: structuredClone(fixture.providerSettings.piggyvest),
      },
      database: {
        treasury: database('prefunded_treasury_operator'),
        ingestion: database('prefunded_evidence'),
        authorizer: database('prefunded_authorizer'),
      },
    },
    fetchImplementation: vi.fn<typeof fetch>(),
  };
}
