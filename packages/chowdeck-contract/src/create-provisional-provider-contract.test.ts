import { createProvisionalProviderContract } from './create-provisional-provider-contract';

it('keeps write access disabled', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  expect(
    createProvisionalProviderContract({
      capturedAt: '2026-09-08T12:00:00.000Z',
      observationManifestDigest: digest,
      publicContractDigest: digest,
    }).capabilities.catalogWrite.enabled
  ).toBe(false);
});
