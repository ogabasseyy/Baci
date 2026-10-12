export function prefundedCardCheckoutFixture() {
  const scope = {
    deployment: 'staging' as const,
    integrationId: '00000000-0000-4000-8000-000000000001',
    merchantId: '00000000-0000-4000-8000-000000000002',
    treasuryBindingId: '00000000-0000-4000-8000-000000000003',
    businessId: 'checkout-test-business',
    systemIdentifier: '7685292944002592802' as const,
    expiresAt: '2026-09-29T15:59:10Z' as const,
  };
  const selection = {
    intentId: '00000000-0000-4000-8000-000000000004',
    customerId: '00000000-0000-4000-8000-000000000005',
    actorId: '00000000-0000-4000-8000-000000000006',
    goalId: '00000000-0000-4000-8000-000000000007',
  };
  const request = {
    customerId: selection.customerId,
    actorId: selection.actorId,
    goalId: selection.goalId,
    amountKobo: 10_000,
    idempotencyKey: '00000000-0000-4000-8000-000000000008',
    consent: {
      version: 'prefunded-first-card-v1' as const,
      oneTimeCharge: true as const,
      saveCard: true as const,
    },
  };
  const intent = {
    ...scope,
    ...selection,
    ...request,
    email: 'checkout@example.test',
    currency: 'NGN' as const,
    reference: `pvb-first-${selection.intentId}`,
    requestFingerprint: 'a'.repeat(64),
  };
  const session = {
    reference: intent.reference,
    authorizationUrl: 'https://checkout.paystack.com/firstCardTest',
  };
  const claim = {
    outcome: 'claimed' as const,
    intent,
    token: '00000000-0000-4000-8000-000000000009',
    fence: 1,
    leaseExpiresAt: '2026-09-26T12:01:00Z',
  };
  const collection = {
    intentId: intent.intentId,
    reference: intent.reference,
    providerTransactionId: '18446744073709551615',
    amountKobo: intent.amountKobo,
    currency: 'NGN' as const,
    domain: 'test' as const,
    authorization: {
      authorizationCode: 'AUTH_checkoutTest',
      signature: 'SIG_checkoutTest',
      customerCode: 'CUS_checkoutTest',
      email: intent.email,
      reusable: true as const,
      brand: 'Visa',
      last4: '4242',
      expiryMonth: '12',
      expiryYear: '2030',
    },
  };
  const customerRequest = {
    goalId: request.goalId,
    amountKobo: request.amountKobo,
    idempotencyKey: request.idempotencyKey,
    consent: request.consent,
  };
  const customerSelection = {
    goalId: selection.goalId,
    intentId: selection.intentId,
  };
  const customerIdentity = {
    goalId: selection.goalId,
    actorId: selection.actorId,
    customerId: selection.customerId,
  };
  const database = {
    environment: 'staging',
    transport: 'tls',
    host: 'staging-db.example.test',
    expectedHost: 'staging-db.example.test',
    port: 5432,
    database: 'staging_savings',
    expectedDatabase: 'staging_savings',
    expectedSystemId: scope.systemIdentifier,
    storageApproved: true,
    expectedProjectId: 'staging-test',
    actualProjectId: 'staging-test',
    password: 'synthetic-only',
  };
  const configuration = {
    scope,
    customerDatabase: {
      ...database,
      profile: 'checkout_customer',
      login: 'prefunded_treasury_operator',
      expectedLogin: 'prefunded_treasury_operator',
    },
    verifierDatabase: {
      ...database,
      profile: 'checkout_authorizer',
      login: 'prefunded_authorizer',
      expectedLogin: 'prefunded_authorizer',
    },
    provider: {
      ...scope,
      paystackSecret: 'sk_test_synthetic',
      callbackUrl: 'https://staging.ogabassey.com/savings/card-return',
    },
  };
  return {
    scope,
    selection,
    request,
    intent,
    session,
    claim,
    collection,
    customerRequest,
    customerSelection,
    customerIdentity,
    configuration,
  };
}
