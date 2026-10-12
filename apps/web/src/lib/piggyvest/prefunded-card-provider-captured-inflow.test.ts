import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { prefundedCardProviderTestFixture as fixture } from './prefunded-card-provider.test-fixture';
import { createPrefundedCardProviderEvidence } from './prefunded-card-provider-evidence';

const configuration = {
  integrationId: fixture.claim.integrationId,
  systemIdentifier: '12345',
  webhookSecret: 'synthetic-captured-shape-secret',
  piggyvest: fixture.providerSettings.piggyvest,
};

function event() {
  return {
    eventId: 'captured-shape-event',
    customer_id: 'customer_destination',
    eventType: 'bank-transfer.inflow.success',
    eventCategory: 'inflow_transaction',
    eventData: {
      id: 'inner-data-id',
      customer_id: 'customer_destination',
      destination_wallet_id: 'wallet_destination',
      type: 'inter',
      category: 'bank_transfer_inflow',
      amount: 10000,
      currency: 'NGN',
      narration: 'Wallet Funding',
      ip_address: '127.0.0.1',
      transaction_id: 'inner-transaction-id',
      timestamp: '2026-09-18T17:57:47.566Z',
      internal_reference: 'bank-reference',
      status: 'COMPLETED',
      provider: 'FAAS',
      third_party_reference: 'bank-reference',
      initiator_reference: 'bank-reference',
      recipient_name: null,
      sender_name: null,
      webhook_data: null,
      fee: 0,
      provider_fee: null,
      destination_wallet_balance: 10000,
      destination_wallet_ledger_balance: 10000,
      destination_transaction_balance: 10000,
      reference: 'bank-reference',
    },
    pvb_reference: 'PVB-bank-transaction',
    pvb_wallet: 'outer-envelope-wallet',
    pvb_destination_wallet: null,
    pvb_third_party_reference: null,
    pvb_schedule_payment_id: null,
    pvb_destination_account_creation_reference: null,
  };
}

function harness(transactionOverrides: Record<string, unknown> = {}) {
  const recorded: unknown[] = [];
  const execute = vi.fn(
    async (statement: string, parameters: readonly string[]) => {
      if (statement.includes('evidence_scope'))
        return {
          rows: [{ result: { businessId: 'business_1', currency: 'NGN' } }],
        };
      if (statement.includes('evidence_destination_mapping'))
        return {
          rows: [
            {
              result: {
                providerWalletId: 'wallet_destination',
                providerCustomerId: 'customer_destination',
              },
            },
          ],
        };
      if (!statement.includes('record_provider_evidence'))
        throw new Error('Unexpected statement');
      recorded.push(JSON.parse(parameters[2]));
      return { rows: [{ result: 'stored' }] };
    }
  );
  const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v1/transaction/PVB-bank-transaction') {
      expect(url.searchParams.get('wallet_id')).toBe('outer-envelope-wallet');
      return fixture.jsonResponse({
        status: true,
        data: {
          id: 'PVB-bank-transaction',
          customer_id: 'customer_destination',
          source_wallet: '',
          destination_wallet: 'wallet_destination',
          reference: 'bank-reference',
          third_party_reference: null,
          internal_reference: 'bank-reference',
          category: 'bank_transfer_inflow',
          status: 'successful',
          amount: 10000,
          fee: 0,
          ...transactionOverrides,
        },
      });
    }
    if (url.pathname.endsWith('/wallet-type')) {
      expect(url.searchParams.get('customer_id')).toBe('customer_destination');
      return fixture.jsonResponse({
        status: true,
        data: {
          paginatedPayload: {
            edges: [
              {
                id: 'wallet_destination',
                business_id: 'business_1',
                currency: 'NGN',
              },
            ],
          },
        },
      });
    }
    if (url.pathname.endsWith('/wallet_destination'))
      return fixture.jsonResponse({
        status: true,
        data: {
          id: 'wallet_destination',
          business_id: 'business_1',
          currency: 'NGN',
          status: 'active',
          balance: 20000,
        },
      });
    throw new Error('Unexpected provider endpoint');
  });
  const service = createPrefundedCardProviderEvidence({
    configuration,
    execute,
    fetchImplementation,
  });
  const ingest = (body: unknown = event()) => {
    const rawPayload = Buffer.from(JSON.stringify(body));
    return service.ingest({
      rawPayload,
      signature: createHmac('sha512', configuration.webhookSecret)
        .update(rawPayload)
        .digest('hex'),
    });
  };
  return { service, ingest, execute, recorded, fetchImplementation };
}

describe('captured PiggyVest bank inflow shape regression', () => {
  it('verifies inter/COMPLETED with absent source/session and distinct envelope wallet', async () => {
    const sample = harness();
    await expect(sample.ingest()).resolves.toEqual({ outcome: 'stored' });
    expect(sample.recorded).toHaveLength(2);
    expect(sample.recorded[0]).toMatchObject({
      status: 'deferred',
      kind: 'unknown',
    });
    expect(sample.recorded[1]).toMatchObject({
      status: 'verified',
      kind: 'bank_inflow',
      eventDataId: 'inner-data-id',
      envelopeWalletId: 'outer-envelope-wallet',
      sourceWalletId: '',
      destinationWalletId: 'wallet_destination',
      destinationCustomerId: 'customer_destination',
      amountKobo: 10000,
      sessionId: null,
      creditedAt: '2026-09-18T17:57:47.566Z',
    });
    expect(sample.fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it.each([
    { source_wallet: 'internal-source' },
    { source_wallet: undefined },
    { amount: 9999 },
    { status: 'pending' },
    { customer_id: 'another-customer' },
    { destination_wallet: 'another-wallet' },
    { reference: 'another-reference' },
    { fee: 1 },
  ])('keeps receipt deferred without matching independent evidence: %j', async (overrides) => {
    const sample = harness(overrides);
    await expect(sample.ingest()).resolves.toEqual({ outcome: 'deferred' });
    expect(sample.recorded).toHaveLength(1);
    expect(sample.recorded[0]).toMatchObject({ status: 'deferred' });
  });

  it('does not consult the provider for a captured payload with an invalid signature', async () => {
    const sample = harness();
    await expect(
      sample.service.ingest({
        rawPayload: Buffer.from(JSON.stringify(event())),
        signature: '0'.repeat(128),
      })
    ).resolves.toEqual({ outcome: 'invalid_signature' });
    expect(sample.execute).not.toHaveBeenCalled();
    expect(sample.fetchImplementation).not.toHaveBeenCalled();
  });

  it('does not infer an external deposit from a wallet-source webhook', async () => {
    const sample = harness();
    const body = event();
    await expect(
      sample.ingest({
        ...body,
        eventData: { ...body.eventData, source_wallet_id: 'internal-source' },
      })
    ).resolves.toEqual({ outcome: 'deferred' });
    expect(sample.recorded).toHaveLength(1);
    expect(sample.fetchImplementation).not.toHaveBeenCalled();
  });
});
