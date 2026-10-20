// Characterization fixtures for the wallet order-funding intent HTTP
// responses. Captured from the two actual response builders — the
// create response (`formatIntentResult`) and the poll response
// (`formatIntent` in the [id] route, which adds the poll-only
// debitedAmount/excessAmount/orderPaid/remainingAmount fields) — not
// from PostgREST rows, which no client parses.
//
// Both fixtures carry an offset-form expiresAt matching the
// repository row shape (`String(row.expires_at)` such as
// '2026-05-21T11:00:00+00:00') that both builders pass through
// unchanged. Client schemas must accept that form; a Z-form fixture
// would pass before and after an offset regression and prove nothing.
export const orderWalletFundingIntentCreateResponseFixture = {
  account: {
    accountName: 'Ogabassey/Jane Doe',
    accountNumber: '1234567890',
    bankName: 'Wema Bank',
    provider: 'paystack',
  },
  intent: {
    currency: 'NGN',
    expectedAmount: 5000,
    expiresAt: '2026-05-21T11:00:00+00:00',
    fundedAmount: 0,
    id: '11111111-1111-4111-8111-111111111111',
    orderId: '22222222-2222-4222-8222-222222222222',
    status: 'pending',
    targetOrderAmount: 5000,
  },
} as const;

export const orderWalletFundingIntentPollResponseFixture = {
  intent: {
    currency: 'NGN',
    debitedAmount: 0,
    excessAmount: 0,
    expectedAmount: 5000,
    expiresAt: '2026-05-21T11:00:00+00:00',
    fundedAmount: 0,
    id: '11111111-1111-4111-8111-111111111111',
    orderPaid: false,
    orderId: '22222222-2222-4222-8222-222222222222',
    remainingAmount: 5000,
    status: 'pending',
    targetOrderAmount: 5000,
  },
} as const;
