import { normalizeWalletTransaction } from './wallet-transaction-normalize';

// The app reads wallet history straight from the database, so the customer
// label is applied here too: no provider name or internal id ever shows.
describe('server keeps PiggyVest off: wallet history labels', () => {
  const base = {
    amount: '2500',
    created_at: '2026-11-13T09:00:00Z',
    id: 'txn-1',
    type: 'redemption',
  };

  it('shows "IMEI check" instead of the provider and lookup id', () => {
    const tx = normalizeWalletTransaction({
      ...base,
      description:
        'Petrock IMEI lookup payment: 3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f',
      source_type: 'imei_wallet_payment',
    });
    expect(tx?.description).toBe('IMEI check');
  });

  it('strips a provider from an older row without a known kind', () => {
    const tx = normalizeWalletTransaction({
      ...base,
      description: 'Partial invoice payment via paystack',
      source_type: null,
    });
    expect(tx?.description).toBe('Partial invoice payment');
  });

  it('keeps a description that names nothing internal', () => {
    const tx = normalizeWalletTransaction({
      ...base,
      description: 'Refund for failed Airtime MTN purchase ₦100',
      source_type: 'vtu_transaction_refund',
    });
    expect(tx?.description).toBe('Refund for failed Airtime MTN purchase ₦100');
  });
});
