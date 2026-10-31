import { describe, expect, it } from 'vitest';
import {
  docsMinimalTransactionStatus,
  docsSingleTransaction,
  docsWalletTransferEnvelope,
} from './provider-transfer-docs.test-support';
import { liveTransactionStatus } from './transaction-status-live.test-support';

const binding = {
  reference: 'pvb-wt-00000000-0000-4000-8000-0000000000a1-1',
  amountKobo: 25000,
  sourceWalletId: '01JBSYNTHETICMAINWALLET001',
  destinationWalletId: '01JBSYNTHETICCOLLECTION001',
};

describe('docs-shaped PiggyVest transfer bodies', () => {
  it('puts our reference only on the webhook envelope', () => {
    const envelope = docsWalletTransferEnvelope(binding);
    expect(envelope).toMatchObject({
      eventType: 'wallet-transfer.outflow.success',
      eventCategory: 'wallet_transfer',
      pvb_wallet: binding.sourceWalletId,
      pvb_destination_wallet: binding.destinationWalletId,
      pvb_third_party_reference: binding.reference,
      eventData: { category: 'p2p', fee: null, amount: binding.amountKobo },
    });
    expect(Object.values(envelope.eventData)).not.toContain(binding.reference);
    expect(envelope.eventData.third_party_reference).toMatch(/^PVB/);
  });

  it('lays the single transaction out with the live TSQ record fields', () => {
    const single = docsSingleTransaction({ ...binding });
    const live = liveTransactionStatus(
      { ...binding, customerId: 'synthetic-customer' },
      'successful'
    );
    expect(Object.keys(single.data).sort()).toEqual(
      [...Object.keys(live.data), 'break_down'].sort()
    );
    expect(single.data).toMatchObject({
      third_party_reference: binding.reference,
      amount: binding.amountKobo,
      source_wallet: binding.sourceWalletId,
      destination_wallet: binding.destinationWalletId,
      category: 'p2p',
      status: 'successful',
    });
  });

  it('keeps the documented minimal status body free of wallets', () => {
    const minimal = docsMinimalTransactionStatus(binding);
    expect(Object.keys(minimal.data).sort()).toEqual([
      'amount',
      'bank',
      'created_at',
      'recipient',
      'reference',
      'status',
    ]);
    expect(minimal.data.reference).toBe(binding.reference);
  });
});
