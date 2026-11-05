import {
  createProvisionalProviderContract,
  parseProviderContract,
  resolveCapability,
} from './provider-contract';

const DIGEST = `sha256:${'b'.repeat(64)}`;

describe('provider contract', () => {
  it('keeps every runtime capability disabled while response semantics are unproven', () => {
    const contract = createProvisionalProviderContract({
      capturedAt: '2026-09-08T12:00:00.000Z',
      observationManifestDigest: DIGEST,
      publicContractDigest: DIGEST,
    });

    expect(parseProviderContract(contract)).toEqual(contract);
    expect(resolveCapability(contract, 'account.read')).toEqual({
      enabled: false,
      code: 'provider_response_schema_unproven',
    });
    expect(resolveCapability(contract, 'catalog.write')).toEqual({
      enabled: false,
      code: 'provider_contract_unproven',
    });
    expect(resolveCapability(contract, 'media.write')).toEqual({
      enabled: false,
      code: 'provider_contract_unproven',
    });
    expect(resolveCapability(contract, 'order.read')).toEqual({
      enabled: false,
      code: 'provider_contract_unproven',
    });
    expect(resolveCapability(contract, 'command.write')).toEqual({
      enabled: false,
      code: 'provider_contract_unproven',
    });
  });

  it('rejects unknown contract fields and attempts to enable an unproven capability', () => {
    const contract = createProvisionalProviderContract({
      capturedAt: '2026-09-08T12:00:00.000Z',
      observationManifestDigest: DIGEST,
      publicContractDigest: DIGEST,
    });

    expect(() =>
      parseProviderContract({ ...contract, baseUrl: 'https://evil.test' })
    ).toThrow('Invalid provider contract');
    expect(() =>
      parseProviderContract({
        ...contract,
        capabilities: {
          ...contract.capabilities,
          catalogWrite: { enabled: true, code: 'provider_contract_unproven' },
        },
      })
    ).toThrow('Invalid provider contract');
  });
});
