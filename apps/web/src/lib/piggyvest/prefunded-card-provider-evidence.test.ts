import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { prefundedCardProviderTestFixture as fixture } from './prefunded-card-provider.test-fixture';
import { createPrefundedCardProviderEvidence } from './prefunded-card-provider-evidence';

const configuration = {
  integrationId: fixture.claim.integrationId,
  systemIdentifier: '12345',
  webhookSecret: 'synthetic-signing-key',
  piggyvest: fixture.providerSettings.piggyvest,
};
const event = {
  eventId: 'event-wallet-1',
  eventType: 'wallet-transfer.outflow.success',
  eventCategory: 'wallet-transfer',
  customer_id: 'customer_source',
  pvb_reference: 'transaction-1',
  pvb_wallet: 'wallet_source',
  eventData: {},
};
const transaction = {
  id: 'transaction-1',
  customer_id: 'customer_source',
  source_wallet: 'wallet_source',
  destination_wallet: 'wallet_destination',
  reference: 'transfer-1',
  third_party_reference: null,
  internal_reference: 'internal-1',
  category: 'wallet_transfer',
  status: 'successful',
  amount: 5000,
  fee: 0,
};

function harness(overrides: Record<string, unknown> = {}) {
  const recorded: unknown[] = [];
  const execute = vi.fn(
    async (
      statement: string,
      parameters: readonly string[]
    ): Promise<{ rows: unknown }> => {
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
      if (statement.includes('record_provider_evidence')) {
        recorded.push(JSON.parse(parameters[2]));
        return { rows: [{ result: 'stored' }] };
      }
      return { rows: [{ result: { outcome: 'deferred' } }] };
    }
  );
  const fetchImplementation = vi.fn(async (url: string | URL | Request) => {
    const address = String(url);
    if (address.includes('/wallet-type?'))
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
    if (address.includes('/wallet/'))
      return fixture.jsonResponse({
        status: true,
        data: {
          id: 'wallet_destination',
          business_id: 'business_1',
          currency: 'NGN',
          balance: 5000,
          status: 'active',
        },
      });
    if (address.includes('/verify?'))
      return fixture.jsonResponse({
        status: true,
        data: { reference: 'transfer-1', status: 'success', amount: 5000 },
      });
    return fixture.jsonResponse({
      status: true,
      data: { ...transaction, ...overrides },
    });
  });
  const service = createPrefundedCardProviderEvidence({
    configuration,
    execute,
    fetchImplementation,
  });
  const ingest = (body: unknown = event) => {
    const rawPayload = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha512', configuration.webhookSecret)
      .update(rawPayload)
      .digest('hex');
    return service.ingest({ rawPayload, signature });
  };
  return { service, ingest, execute, fetchImplementation, recorded };
}

describe('independent prefunded provider evidence', () => {
  it('combines documented single transaction and TSQ without invented business or customer fields', async () => {
    const test = harness();
    expect(await test.ingest()).toEqual({ outcome: 'stored' });
    expect(test.recorded).toHaveLength(2);
    expect(test.recorded[0]).toMatchObject({ status: 'deferred' });
    expect(test.recorded[1]).toMatchObject({
      status: 'verified',
      kind: 'internal_transfer',
      sourceWalletId: 'wallet_source',
      destinationWalletId: 'wallet_destination',
      destinationCustomerId: 'customer_destination',
      amountKobo: 5000,
      reference: 'transfer-1',
    });
    expect(
      test.fetchImplementation.mock.calls.every(([url]) =>
        String(url).startsWith('https://staging.piggyvest.business/')
      )
    ).toBe(true);
  });

  it('persists unknown identity before the provider lookup and leaves it deferred on failure', async () => {
    const test = harness();
    test.fetchImplementation.mockRejectedValue(
      new Error('synthetic provider unavailable')
    );
    expect(await test.ingest()).toEqual({ outcome: 'deferred' });
    expect(test.recorded).toHaveLength(1);
    expect(test.recorded[0]).toMatchObject({
      status: 'deferred',
      eventId: event.eventId,
    });
  });

  it.each([
    { id: 'unrelated' },
    { customer_id: 'other' },
    { source_wallet: 'other' },
    { status: 'pending' },
    { amount: 4999 },
    { fee: 1 },
  ])('does not fill missing or mismatched evidence from the request: %j', async (overrides) => {
    const test = harness(overrides);
    expect(await test.ingest()).toEqual({ outcome: 'deferred' });
    expect(test.recorded).toHaveLength(1);
  });

  it('rejects invalid signatures before database or provider work', async () => {
    const test = harness();
    expect(
      await test.service.ingest({
        rawPayload: Buffer.from(JSON.stringify(event)),
        signature: '0'.repeat(128),
      })
    ).toEqual({ outcome: 'invalid_signature' });
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.fetchImplementation).not.toHaveBeenCalled();
  });

  it('recognizes positive external bank category with explicitly empty source', async () => {
    const test = harness({
      source_wallet: '',
      customer_id: 'customer_destination',
      category: 'bank_transfer_inflow',
      reference: 'bank-1',
    });
    const bank = {
      ...event,
      eventType: 'bank-transfer.inflow.success',
      eventCategory: 'bank-transfer',
      customer_id: 'customer_destination',
      pvb_wallet: 'wallet_destination',
      eventData: {
        id: 'bank-data-1',
        transaction_id: 'bank-transaction-1',
        reference: 'bank-1',
        customer_id: 'customer_destination',
        source_wallet_id: '',
        destination_wallet_id: 'external-provider-wallet',
        type: 'inflow',
        category: 'bank_transfer_inflow',
        status: 'success',
        amount: 5000,
        fee: 0,
        currency: 'NGN',
        session_id: 'session-1',
      },
    };
    expect(await test.ingest(bank)).toEqual({ outcome: 'stored' });
    expect(test.recorded[1]).toMatchObject({
      kind: 'bank_inflow',
      sourceWalletId: '',
      reference: 'bank-1',
    });
  });

  it('does not classify a bank event with a wallet source as an external deposit', async () => {
    const test = harness();
    expect(
      await test.ingest({
        ...event,
        eventType: 'bank-transfer.inflow.success',
        eventCategory: 'bank-transfer',
      })
    ).toEqual({ outcome: 'deferred' });
  });

  it.each([
    {},
    { session_id: null },
  ])('accepts captured inflow_transaction with distinct wallet identities and nullable session: %j', async (session) => {
    const test = harness({
      id: 'PVB-bank-transaction',
      source_wallet: '',
      customer_id: 'customer_destination',
      category: 'bank_transfer_inflow',
      reference: 'bank-1',
    });
    const bank = {
      ...event,
      customer_id: 'customer_destination',
      eventType: 'bank-transfer.inflow.success',
      eventCategory: 'inflow_transaction',
      pvb_reference: 'PVB-bank-transaction',
      pvb_wallet: 'outer-pvb-wallet',
      eventData: {
        id: 'bank-data',
        transaction_id: 'bank-tx',
        reference: 'bank-1',
        customer_id: 'customer_destination',
        source_wallet_id: '',
        destination_wallet_id: 'wallet_destination',
        type: 'inflow',
        category: 'bank_transfer_inflow',
        status: 'success',
        amount: 5000,
        fee: 0,
        currency: 'NGN',
        timestamp: '2026-09-26T12:00:00Z',
        ...session,
      },
    };
    expect(await test.ingest(bank)).toEqual({ outcome: 'stored' });
    expect(test.recorded[1]).toMatchObject({
      eventCategory: 'inflow_transaction',
      status: 'verified',
      kind: 'bank_inflow',
      eventDataId: 'bank-data',
      envelopeWalletId: 'outer-pvb-wallet',
      destinationWalletId: 'wallet_destination',
      sessionId: null,
      creditedAt: '2026-09-26T12:00:00Z',
    });
  });

  it('requires independent destination ownership instead of treating the transaction sender as its customer', async () => {
    const test = harness();
    await test.ingest();
    expect(test.recorded[1]).toMatchObject({
      destinationCustomerId: 'customer_destination',
    });
    expect(
      test.fetchImplementation.mock.calls.some(([url]) =>
        String(url).includes('customer_id=customer_destination')
      )
    ).toBe(true);
  });
});
