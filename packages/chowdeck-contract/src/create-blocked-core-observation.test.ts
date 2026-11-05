import { createBlockedCoreObservation } from './create-blocked-core-observation';

it('enforces the observation contract', () => {
  expect(
    createBlockedCoreObservation({
      capturedAt: '2026-09-08T12:00:00.000Z',
      manifestDigest: `sha256:${'a'.repeat(64)}`,
      publicContractDigest: `sha256:${'a'.repeat(64)}`,
    }).status
  ).toBe('not_observed');
});
