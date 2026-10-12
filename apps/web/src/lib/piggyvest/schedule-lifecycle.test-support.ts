export function scheduleLifecycleFixture() {
  const scope = {
    integrationId: '10000000-0000-4000-8000-000000000001',
    merchantId: '20000000-0000-4000-8000-000000000001',
    customerId: '30000000-0000-4000-8000-000000000001',
    goalId: '40000000-0000-4000-8000-000000000001',
  };
  const device = {
    productId: 'synthetic-device',
    variantId: null,
    condition: 'new',
  };
  return {
    trusted: {
      environment: 'staging' as const,
      transport: 'local_test' as const,
      scope,
      actorId: '50000000-0000-4000-8000-000000000001',
      collectionOwner: 'piggyvest' as const,
      revisionId: '60000000-0000-4000-8000-000000000001',
      termsHash: 'a'.repeat(64),
      maturity: {
        maturesAt: '2026-10-12T09:00:00Z',
        graceExpiresAt: '2026-11-11T09:00:00Z',
      },
      policy: {
        policyVersion: '2026-09-11' as const,
        now: '2026-09-12T09:00:00Z',
        goalState: 'active' as const,
        requestedAction: 'none' as const,
        collectionPaused: true,
        hasBeforeFundingConsent: true,
        cancellationInterestForfeitureConsentVersion: '2026-09-11' as const,
        device,
        ledger: {
          confirmedPrincipalKobo: 100,
          reservedPrincipalKobo: 0,
          paidEligibleInterestKobo: 0,
          reservedPaidInterestKobo: 0,
          pendingInterestKobo: 0,
        },
        activationQuote: null,
        currentOffer: { device, priceKobo: 10000 },
        guarantee: null,
        maturityGraceExpiresAt: '2026-11-11T09:00:00Z',
        fundingReversed: false,
        reservation: 'none' as const,
      },
    },
    state: {
      scope,
      version: 0,
      status: 'paused' as const,
      consentProposal: null,
    },
    command: {
      action: 'observe' as const,
      goalId: scope.goalId,
      expectedVersion: 0,
    },
  };
}
