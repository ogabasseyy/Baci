import { describe, expect, it, vi } from 'vitest';
import { prefundedCardLegacyProofTestFixture as fixture } from './prefunded-card-legacy-proof.test-fixture';

const { setup, legacy, envelope } = fixture;

describe('existing plan migration evidence', () => {
  it('reconciles the observed business-scoped bank-inflow summary with its credited wallet in source_wallet', async () => {
    const test = setup({
      apiCustomerId: 'api-customer-alias',
      transaction: {
        customer_id: 'business-test',
        source_wallet: legacy.providerWalletId,
        destination_wallet: '',
        category: 'bank-inflow',
      },
    });
    const proof = await test.run();
    expect(proof.observation).toMatchObject({
      kind: 'bank_inflow',
      providerTransactionId: envelope.pvb_reference,
      destinationCustomerId: legacy.providerCustomerId,
      destinationWalletId: legacy.providerWalletId,
      sourceWalletId: '',
      amountKobo: 10000,
    });
    expect(
      test.fetchImplementation.mock.calls.map(([url]) => String(url))
    ).toContain(
      'https://staging.piggyvest.business/api/v1/wallet/api/wallet-type?customer_id=api-customer-alias&limit=100'
    );
  });

  it.each([
    { customer_id: 'another-business' },
    { source_wallet: 'another-wallet' },
    { destination_wallet: 'internal-destination' },
    { category: 'bank-outflow' },
  ])('does not confuse a different business or an internal/outgoing summary with bank credit: %j', async (change) => {
    await expect(
      setup({
        transaction: {
          customer_id: 'business-test',
          source_wallet: legacy.providerWalletId,
          destination_wallet: '',
          category: 'bank-inflow',
          ...change,
        },
      }).run()
    ).rejects.toThrow('Legacy proof refused');
  });
  it('links the signed legacy UUID to the independently verified PVB identifier without issuing a credit', async () => {
    const test = setup();
    const proof = await test.run();
    expect(proof).toMatchObject({
      legacyProviderTransactionId: legacy.providerTransactionId,
      contributionId: legacy.contributionId,
      payloadSha256: test.fingerprint,
      observation: {
        providerTransactionId: envelope.pvb_reference,
        amountKobo: 10000,
        status: 'verified',
        kind: 'bank_inflow',
      },
    });
    expect(proof.observation.references).toContain(
      legacy.providerTransactionId
    );
    expect(test.fetchImplementation).toHaveBeenCalledTimes(3);
    for (const [, init] of test.fetchImplementation.mock.calls) {
      expect(init?.method).toBe('GET');
    }
    expect(JSON.stringify(proof)).not.toContain('synthetic-secret');
  });

  it('reconciles an authenticated encrypted original without claiming to recover its missing HMAC', async () => {
    const test = setup({ signature: null, reconcileStoredReceipt: true });
    const proof = await test.run();
    expect(proof.provenance).toBe('provider_reconciliation');
    expect(proof.observation.status).toBe('verified');
    expect(test.fetchImplementation).toHaveBeenCalledTimes(3);
    expect(proof).not.toHaveProperty('signature');
  });

  it('never treats encrypted storage as settlement proof when provider reconciliation disagrees', async () => {
    await expect(
      setup({
        signature: null,
        reconcileStoredReceipt: true,
        transaction: { amount: 9999 },
      }).run()
    ).rejects.toThrow('Legacy proof refused');
  });

  it('does not fall back to stored-only authentication for an invalid retained signature', async () => {
    const test = setup({
      signature: '0'.repeat(128),
      reconcileStoredReceipt: true,
    });
    await expect(test.run()).rejects.toThrow('Legacy proof refused');
    expect(test.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    null,
    '0'.repeat(128),
  ])('refuses missing or invalid original signatures before provider calls: %s', async (signature) => {
    const test = setup({ signature });
    await expect(test.run()).rejects.toThrow('Legacy proof refused');
    expect(test.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    { providerTransactionId: 'different-transaction' },
    { eventDataId: 'different-data' },
    { eventId: 'different-event' },
    { providerCustomerId: 'different-customer' },
    { amountKobo: 20000 },
    { reference: 'different-reference' },
    { creditedAt: '2026-09-25T12:00:01Z' },
    { integrationId: '30000000-0000-4000-8000-000000000001' },
  ])('rejects legacy identity drift instead of matching solely by amount: %j', async (change) => {
    const test = setup({ legacy: change });
    await expect(test.run()).rejects.toThrow('Legacy proof refused');
    expect(test.fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    { transaction: { id: 'different-provider-transaction' } },
    { transaction: { destination_wallet: 'different-wallet' } },
    { transaction: { status: 'pending' } },
    { transaction: { fee: 1 } },
    { transaction: { amount: 9999 } },
    { businessId: 'different-business' },
  ])('refuses independent provider evidence mismatch: %j', async (change) => {
    await expect(setup(change).run()).rejects.toThrow('Legacy proof refused');
  });

  it('refuses a different encrypted-receipt digest', async () => {
    const test = setup({ fingerprint: '0'.repeat(64) });
    await expect(test.run()).rejects.toThrow('Legacy proof refused');
    expect(test.fetchImplementation).not.toHaveBeenCalled();
  });

  it('refuses deadline expiry before any calls and during verification', async () => {
    const deadline = Date.parse('2026-09-29T15:59:10Z');
    const expired = setup({ now: () => deadline });
    await expect(expired.run()).rejects.toThrow('Legacy proof refused');
    expect(expired.fetchImplementation).not.toHaveBeenCalled();
    await expect(
      setup({
        now: vi
          .fn()
          .mockReturnValueOnce(deadline - 1)
          .mockReturnValue(deadline),
      }).run()
    ).rejects.toThrow('Legacy proof refused');
  });

  it.each([
    [Date.parse('2026-09-27T11:59:59Z'), Date.parse('2026-09-27T12:00:00Z')],
    [Date.parse('2026-09-27T12:00:01Z'), Date.parse('2026-09-27T12:00:00Z')],
    [Number.NaN, Date.parse('2026-09-27T12:00:00Z')],
  ])('rejects provider response timestamps outside the verification window', async (retrievedAt, finishedAt) => {
    const test = setup({
      nowValues: [Date.parse('2026-09-27T12:00:00Z'), retrievedAt, finishedAt],
    });

    await expect(test.run()).rejects.toThrow('Legacy proof refused');
  });

  it('bounds elapsed work with a monotonic clock even when wall time is unchanged', async () => {
    const monotonicTimes = [0, 30_001];
    const test = setup({
      monotonicNow: () => monotonicTimes.shift() ?? 30_001,
    });

    await expect(test.run()).rejects.toThrow('Legacy proof refused');
  });

  it('redacts provider exceptions rather than leaking the original payload or secret', async () => {
    const test = setup();
    test.fetchImplementation.mockRejectedValue(
      new Error('synthetic-secret body')
    );
    await expect(test.run()).rejects.toThrow(/^Legacy proof refused$/);
  });
});
