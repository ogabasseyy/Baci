export function savingsViewFixture() {
  const identity = {
    integrationId: '44444444-4444-4444-8444-444444444444',
    merchantId: '11111111-1111-4111-8111-111111111111',
    customerId: '22222222-2222-4222-8222-222222222222',
    goalId: '33333333-3333-4333-8333-333333333333',
  };
  const device = {
    productId: 'synthetic-device',
    variantId: 'synthetic-variant',
    condition: 'new',
  };
  const configuration = {
    environment: 'staging',
    integrationId: identity.integrationId,
    merchantId: identity.merchantId,
    expectedProjectId: 'synthetic-project',
    actualProjectId: 'synthetic-project',
    allowlistedCustomerIds: [identity.customerId],
  };
  const policy = {
    policyVersion: '2026-09-11',
    goalState: 'active',
    requestedAction: 'none',
    collectionPaused: false,
    hasBeforeFundingConsent: true,
    cancellationInterestForfeitureConsentVersion: '2026-09-11',
    device,
    activationQuote: null,
    currentOffer: { device, priceKobo: 10000 },
    guarantee: null,
  };
  const stored = {
    ledger: {
      confirmedPrincipalKobo: 9500,
      paidEligibleInterestKobo: 0,
      pendingInterestKobo: 500,
      reservedPrincipalKobo: 0,
      reservedPaidInterestKobo: 0,
    },
    activeReservation: null,
    fundingReversed: false,
  };
  return { configuration, goal: { identity, policy }, stored };
}
