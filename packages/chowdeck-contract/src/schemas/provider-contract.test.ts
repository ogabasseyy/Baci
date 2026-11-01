import { providerContractSchema } from './provider-contract';

const DIGEST = `sha256:${'e'.repeat(64)}`;

describe('provider contract schema', () => {
  it('rejects an enabled write capability in the provisional contract', () => {
    const contract = {
      contractVersion: 1,
      capturedAt: '2026-09-08T12:00:00.000Z',
      publicContractDigest: DIGEST,
      observationManifestDigest: DIGEST,
      capabilities: {
        accountRead: {
          enabled: false,
          code: 'provider_response_schema_unproven',
        },
        catalogRead: {
          enabled: false,
          code: 'provider_pagination_unproven',
        },
        catalogWrite: { enabled: true, code: 'provider_contract_unproven' },
        mediaWrite: { enabled: false, code: 'provider_contract_unproven' },
        orderRead: { enabled: false, code: 'provider_contract_unproven' },
        commandWrite: { enabled: false, code: 'provider_contract_unproven' },
      },
    };

    expect(providerContractSchema.safeParse(contract).success).toBe(false);
  });
});
