import { createProvisionalProviderContract } from './create-provisional-provider-contract';
import { resolveCapability } from './resolve-capability';

it('returns the disabled account-read decision', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const contract = createProvisionalProviderContract({
    capturedAt: '2026-09-08T12:00:00.000Z',
    observationManifestDigest: digest,
    publicContractDigest: digest,
  });
  expect(resolveCapability(contract, 'account.read').enabled).toBe(false);
});
