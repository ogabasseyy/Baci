import { CONTRACT_E2E } from './constants.mjs';

export function createContractReport(harness, checks) {
  return {
    label: 'synthetic-disposable-source-contract-e2e-not-provider-payout',
    checks,
    snapshot: harness.snapshot(),
    grossKobo: 814,
    taxKobo: 81,
    netKobo: 733,
    fractionalKobo: CONTRACT_E2E.fractionalKobo,
    applicationOutcomes: {
      applied: harness.outcomes.filter((outcome) => outcome === 'applied')
        .length,
      duplicate: harness.outcomes.filter((outcome) => outcome === 'duplicate')
        .length,
      deferred: harness.outcomes.filter((outcome) => outcome === 'deferred')
        .length,
      conflict: harness.outcomes.filter((outcome) => outcome === 'conflict')
        .length,
    },
    sourceManifest: harness.manifest(),
    providerPayoutVerified: false,
    deviceReceiptVerified: false,
    liveWritesPerformed: false,
    pushSendPerformed: false,
  };
}
