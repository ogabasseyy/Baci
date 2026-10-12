import { purchaseCurrentRecoveryFixture } from './purchase-current-recovery.fixture';

export function paymentLegRecoveryFixture() {
  const fixture = purchaseCurrentRecoveryFixture();
  return {
    ...fixture,
    configuration: { ...fixture.configuration, enabled: true },
    result: {
      ...fixture.result,
      paymentLegRecovery: {
        completion: 'metadata_only',
        financialEffects: 'UNKNOWN',
        dispatch: 'disabled',
        retry: 'not_authorized',
        compensation: 'not_authorized',
        reasonEvidence: 'reported_unresolved_only',
        legs: [
          {
            operationId: fixture.input.operationId,
            leg: 'savings',
            amountKobo: 100,
          },
          {
            operationId: fixture.input.operationId,
            leg: 'other',
            amountKobo: 10,
          },
        ].map((leg) => ({
          ...leg,
          referenceType: 'local_intent_leg',
          outcome: 'unknown',
          providerReference: null,
          observationCount: 0,
          latestObservation: null,
        })),
        historicalObservation: null,
      },
    },
  };
}
