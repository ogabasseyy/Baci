export function purchaseCurrentRecoveryFixture() {
  const uuid = '30000000-0000-4000-8000-000000000001';
  return {
    configuration: {
      environment: 'staging',
      transport: 'local_test',
      integrationId: uuid,
      merchantId: uuid,
      customerId: uuid,
      goalId: uuid,
      actorId: uuid,
      expectedBusinessId: 'synthetic',
    },
    input: { operationId: uuid },
    result: {
      status: 'purchase_pending',
      operationId: uuid,
      quoteId: uuid,
      savingsKobo: 100,
      otherPaymentKobo: 10,
      principalKobo: 90,
      paidInterestKobo: 10,
      surplusKobo: 5,
      collectionPaused: true,
      dispatch: 'contract_gap',
      fulfilment: 'disabled',
      current: {
        status: 'observed',
        reservation: 'retained',
        balances: {
          unreservedPrincipalKobo: 55,
          unreservedPaidInterestKobo: 0,
          pendingInterestKobo: 7,
        },
        evidence: 'internal_ledger_only',
        fundsUse: 'not_authorized',
        retry: 'not_authorized',
        observedAt: '2026-09-12T00:00:00Z',
      },
    },
  };
}
