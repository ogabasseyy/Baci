import { coreObservationManifestSchema } from './core-observation-manifest';

describe('core observation manifest schema', () => {
  it('rejects a live-enabled operation before response semantics are proven', () => {
    const result = coreObservationManifestSchema.safeParse({
      version: 1,
      baseUrl: 'https://api.chowdeck.com/merchant',
      publicContractDigest: `sha256:${'f'.repeat(64)}`,
      readiness: 'blocked_contract_evidence',
      blockerCode: 'provider_response_schema_unproven',
      limits: {
        maxRequests: 20,
        requestTimeoutMs: 10_000,
        totalTimeoutMs: 60_000,
        responseBytes: 1_048_576,
        totalBytes: 5_242_880,
        maxDepth: 32,
        maxNodes: 20_000,
      },
      transport: {
        method: 'GET',
        redirect: 'error',
        acceptEncoding: 'identity',
      },
      operations: [
        {
          id: 'account_profile',
          pathTemplate: '/',
          evidence: 'documented',
          enabled: true,
          blockerCode: 'provider_response_schema_unproven',
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
