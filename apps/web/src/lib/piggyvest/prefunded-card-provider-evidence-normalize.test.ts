import { describe, expect, it, vi } from 'vitest';
import { prefundedCardProviderEvidenceSchemas as schemas } from '@/schemas/prefunded-card-provider-evidence';
import { prefundedCardProviderTestFixture as fixture } from './prefunded-card-provider.test-fixture';
import { normalizePrefundedCardProviderEvidence } from './prefunded-card-provider-evidence-normalize';

function argumentsForTest() {
  const configuration = schemas.configuration.parse({
    integrationId: fixture.claim.integrationId,
    systemIdentifier: '12345',
    webhookSecret: 'synthetic',
    piggyvest: fixture.providerSettings.piggyvest,
  });
  const envelope = schemas.envelope.parse({
    eventId: 'event',
    eventType: 'wallet-transfer.outflow.success',
    eventCategory: 'wallet-transfer',
    customer_id: 'sender-customer',
    pvb_reference: 'tx',
    pvb_wallet: 'source',
    eventData: {},
  });
  const observation = schemas.observation.parse({
    eventId: 'event',
    eventType: envelope.eventType,
    eventCategory: envelope.eventCategory,
    eventDataId: null,
    envelopeWalletId: 'source',
    sessionId: null,
    creditedAt: null,
    fingerprint: 'a'.repeat(64),
    status: 'deferred',
    kind: 'unknown',
    providerTransactionId: 'tx',
    destinationCustomerId: 'sender-customer',
    sourceWalletId: null,
    destinationWalletId: null,
    reference: null,
    references: ['tx'],
    amountKobo: null,
    feeKobo: null,
    currency: null,
  });
  const fetchImplementation = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes('/wallet-type?'))
      return fixture.jsonResponse({
        status: true,
        data: { paginatedPayload: { edges: [] } },
      });
    if (String(url).includes('/wallet/'))
      return fixture.jsonResponse({
        status: true,
        data: {
          id: 'destination',
          business_id: 'business_1',
          currency: 'NGN',
          balance: 0,
          status: 'active',
        },
      });
    return fixture.jsonResponse({
      status: true,
      data: {
        id: 'tx',
        customer_id: 'sender-customer',
        source_wallet: 'source',
        destination_wallet: 'destination',
        status: 'successful',
        amount: 100,
        fee: 0,
        category: 'wallet_transfer',
        reference: 'transfer-1',
      },
    });
  });
  const resolveDestination = vi.fn(async () => ({
    providerWalletId: 'destination',
    providerCustomerId: 'recipient-customer',
  }));
  return {
    configuration,
    envelope,
    observation,
    fetchImplementation,
    resolveDestination,
  };
}

function bankArgumentsForTest({
  businessSummary = true,
  walletApiCustomerId = 'api-profile-alias',
  listedApiCustomerId = walletApiCustomerId,
}: {
  businessSummary?: boolean;
  walletApiCustomerId?: string | null;
  listedApiCustomerId?: string | null;
} = {}) {
  const parameters = argumentsForTest();
  const walletId = 'treasury-source-wallet';
  parameters.envelope.eventType = 'bank-transfer.inflow.success';
  parameters.envelope.eventCategory = 'inflow_transaction';
  parameters.envelope.customer_id = 'webhook-customer-uuid';
  parameters.envelope.pvb_reference = 'bank-transaction';
  parameters.envelope.pvb_wallet = walletId;
  parameters.envelope.eventData = {
    id: 'bank-event-data',
    transaction_id: 'bank-transaction-uuid',
    customer_id: 'webhook-customer-uuid',
    destination_wallet_id: walletId,
    type: 'inter',
    category: 'bank_transfer_inflow',
    status: 'COMPLETED',
    amount: 10_000,
    fee: 0,
    currency: 'NGN',
    reference: 'bank-reference',
    timestamp: '2026-09-25T12:00:00Z',
  };
  parameters.resolveDestination.mockResolvedValue({
    providerWalletId: walletId,
    providerCustomerId: 'webhook-customer-uuid',
  });
  parameters.fetchImplementation.mockImplementation(async (url) => {
    const address = String(url);
    const wallet = {
      id: walletId,
      business_id: 'business_1',
      currency: 'NGN',
      balance: 10_000,
      status: 'active',
      ...(walletApiCustomerId ? { api_customer_id: walletApiCustomerId } : {}),
    };
    if (address.includes('/wallet-type?')) {
      return fixture.jsonResponse({
        status: true,
        data: {
          paginatedPayload: {
            edges: [
              {
                id: walletId,
                business_id: 'business_1',
                currency: 'NGN',
                ...(listedApiCustomerId
                  ? { api_customer_id: listedApiCustomerId }
                  : {}),
              },
            ],
          },
        },
      });
    }
    if (address.includes('/wallet/'))
      return fixture.jsonResponse({ status: true, data: wallet });
    return fixture.jsonResponse({
      status: true,
      data: {
        id: 'bank-transaction',
        customer_id: businessSummary ? 'business_1' : 'webhook-customer-uuid',
        source_wallet: businessSummary ? walletId : '',
        destination_wallet: businessSummary ? '' : walletId,
        reference: 'bank-reference',
        category: businessSummary ? 'bank-inflow' : 'bank_transfer_inflow',
        status: 'successful',
        amount: 10_000,
        fee: 0,
      },
    });
  });
  return parameters;
}

describe('provider evidence ownership normalization', () => {
  it('requires the API customer alias for a business-scoped bank summary', async () => {
    const parameters = bankArgumentsForTest({ walletApiCustomerId: null });

    expect(await normalizePrefundedCardProviderEvidence(parameters)).toBeNull();
    expect(parameters.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('rejects a listed API alias that differs from the queried wallet alias', async () => {
    const parameters = bankArgumentsForTest({
      listedApiCustomerId: 'different-api-profile',
    });

    expect(await normalizePrefundedCardProviderEvidence(parameters)).toBeNull();
    expect(
      parameters.fetchImplementation.mock.calls.map(([url]) => String(url))
    ).toContain(
      'https://staging.piggyvest.business/api/v1/wallet/api/wallet-type?customer_id=api-profile-alias&limit=100'
    );
  });

  it('preserves the documented legacy customer filter when both API aliases are absent', async () => {
    const parameters = bankArgumentsForTest({
      businessSummary: false,
      walletApiCustomerId: null,
      listedApiCustomerId: null,
    });

    await expect(
      normalizePrefundedCardProviderEvidence(parameters)
    ).resolves.toMatchObject({
      status: 'verified',
      kind: 'bank_inflow',
      destinationCustomerId: 'webhook-customer-uuid',
    });
    expect(
      parameters.fetchImplementation.mock.calls.map(([url]) => String(url))
    ).toContain(
      'https://staging.piggyvest.business/api/v1/wallet/api/wallet-type?customer_id=webhook-customer-uuid&limit=100'
    );
  });

  it.each([
    'another-api-customer',
    null,
  ])('refuses a list entry whose API customer differs from the retrieved wallet: %s', async (apiCustomerId) => {
    const parameters = argumentsForTest();
    const originalFetch =
      parameters.fetchImplementation.getMockImplementation();
    if (!originalFetch) throw new Error('Missing provider fixture');
    parameters.fetchImplementation.mockImplementation(async (url) => {
      const response = await originalFetch(url);
      const body = await response.json();
      if (String(url).includes('/wallet-type?')) {
        body.data.paginatedPayload.edges = [
          {
            id: 'destination',
            business_id: 'business_1',
            currency: 'NGN',
            api_customer_id: apiCustomerId,
          },
        ];
      } else if (String(url).includes('/wallet/')) {
        body.data.api_customer_id = 'verified-api-customer';
      }
      return fixture.jsonResponse(body);
    });
    expect(await normalizePrefundedCardProviderEvidence(parameters)).toBeNull();
    expect(parameters.fetchImplementation.mock.calls).toHaveLength(3);
  });

  it('defers when the independently mapped customer does not own the destination wallet in the provider list', async () => {
    const parameters = argumentsForTest();
    expect(await normalizePrefundedCardProviderEvidence(parameters)).toBeNull();
    expect(
      parameters.fetchImplementation.mock.calls.some(([url]) =>
        String(url).includes('customer_id=recipient-customer')
      )
    ).toBe(true);
  });

  it('refuses a resolver response for another wallet', async () => {
    const parameters = argumentsForTest();
    parameters.resolveDestination.mockResolvedValue({
      providerWalletId: 'other-wallet',
      providerCustomerId: 'recipient-customer',
    });
    expect(await normalizePrefundedCardProviderEvidence(parameters)).toBeNull();
    expect(parameters.fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('does not query the provider for an unsupported category', async () => {
    const parameters = argumentsForTest();
    parameters.envelope.eventCategory = 'unknown';
    expect(await normalizePrefundedCardProviderEvidence(parameters)).toBeNull();
    expect(parameters.fetchImplementation).not.toHaveBeenCalled();
  });
});
