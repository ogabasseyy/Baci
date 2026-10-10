import { describe, expect, it } from 'vitest';
import { savingsExitEvidenceSchemas as schemas } from './savings-exit-evidence';

const receipt = {
  eventId: 'exit-event',
  providerTransactionId: 'provider-transaction',
  providerCustomerId: 'customer',
  reference: '30000000-0000-4000-8000-000000004212',
  sourceWalletId: 'source',
  destinationWalletId: 'destination',
  businessId: 'business',
  currency: 'NGN',
  amountKobo: 100,
  feeKobo: 0,
  payloadSha256: 'a'.repeat(64),
};
describe('savings exit evidence boundaries', () => {
  it('accepts only bounded local recorder configuration', () => {
    const configuration = {
      integrationId: receipt.reference,
      socketDirectory:
        '/private/tmp/baci-savings-exit-accounting.fixture/socket',
      port: 55454,
      password: 'synthetic-local-only',
    };
    expect(
      schemas.localStoreConfiguration.safeParse(configuration).success
    ).toBe(true);
    for (const changes of [
      { port: 0 },
      { port: 65536 },
      { port: 1.5 },
      { socketDirectory: '/tmp/elsewhere' },
      { password: 'remote-password' },
      { role: 'service_role' },
    ]) {
      expect(
        schemas.localStoreConfiguration.safeParse({
          ...configuration,
          ...changes,
        }).success
      ).toBe(false);
    }
  });
  it('accepts an explicit bounded receipt', () => {
    expect(schemas.receipt.parse(receipt)).toEqual(receipt);
  });
  it.each([
    { eventId: '' },
    { providerTransactionId: 'x'.repeat(129) },
    { providerCustomerId: ' ' },
    { reference: 'not-a-uuid' },
    { sourceWalletId: '../wallet' },
    { destinationWalletId: '' },
    { businessId: '' },
    { currency: 'USD' },
    { amountKobo: 0 },
    { amountKobo: 1.5 },
    { amountKobo: Number.MAX_SAFE_INTEGER + 1 },
    { feeKobo: -1 },
    { payloadSha256: 'not-a-hash' },
    { status: 'success' },
  ])('rejects invalid receipt fields: %j', (changes) => {
    expect(schemas.receipt.safeParse({ ...receipt, ...changes }).success).toBe(
      false
    );
  });
  it('rejects missing credentials or request-selected authority configuration', () => {
    const configuration = {
      integrationId: receipt.reference,
      expectedBusinessId: 'business',
      webhookSecret: 'synthetic-signing',
      apiSecret: 'synthetic-api',
    };
    expect(schemas.configuration.safeParse(configuration).success).toBe(true);
    expect(
      schemas.configuration.safeParse({ ...configuration, apiSecret: '' })
        .success
    ).toBe(false);
    expect(
      schemas.configuration.safeParse({ ...configuration, amountKobo: 100 })
        .success
    ).toBe(false);
  });
  it('requires complete independently returned provider response identity and statuses', () => {
    const transaction = {
      status: true,
      data: {
        id: 'transaction',
        customer_id: 'customer',
        source_wallet: 'source',
        destination_wallet: 'destination',
        reference: receipt.reference,
        category: 'wallet_transfer',
        status: 'successful',
        amount: 100,
        fee: 0,
      },
    };
    expect(schemas.transaction.safeParse(transaction).success).toBe(true);
    expect(
      schemas.transaction.safeParse({
        ...transaction,
        data: { ...transaction.data, status: 'success' },
      }).success
    ).toBe(false);
    expect(
      schemas.tsq.safeParse({
        status: true,
        data: { reference: receipt.reference, amount: 100, status: 'success' },
      }).success
    ).toBe(true);
    expect(
      schemas.tsq.safeParse({
        status: true,
        data: { reference: receipt.reference, status: 'success' },
      }).success
    ).toBe(false);
    expect(
      schemas.wallet.safeParse({
        status: true,
        data: {
          id: 'wallet',
          business_id: 'business',
          currency: 'NGN',
          status: 'active',
        },
      }).success
    ).toBe(true);
    expect(
      schemas.wallet.safeParse({
        status: true,
        data: { id: 'wallet', currency: 'NGN', status: 'active' },
      }).success
    ).toBe(false);
  });
  it('validates signed-envelope and database acknowledgement shapes', () => {
    const envelope = {
      eventId: 'event',
      customer_id: 'customer',
      eventType: 'wallet-transfer.outflow.success',
      pvb_reference: 'transaction',
      pvb_wallet: 'wallet',
    };
    expect(schemas.envelope.safeParse(envelope).success).toBe(true);
    expect(
      schemas.envelope.safeParse({ ...envelope, pvb_reference: undefined })
        .success
    ).toBe(false);
    expect(
      schemas.storedRows.safeParse([{ result: { state: 'stored' } }]).success
    ).toBe(true);
    expect(schemas.storedRows.safeParse([]).success).toBe(false);
    expect(
      schemas.storedRows.safeParse([{ result: { state: 'accounted' } }]).success
    ).toBe(false);
  });
});
