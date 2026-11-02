import { describe, expect, it } from 'vitest';
import { piggyvestTransactionStatusSchemas as schemas } from '@/schemas/piggyvest-transaction-status';
import {
  readerCollection,
  readerExpected,
  readerLiveRecord,
  readerMain,
  readerReference,
} from './provider-transfer-reader.test-support';

describe('provider transfer reader fixtures', () => {
  it('registers two distinct NGN wallets and a valid expectation', () => {
    expect(readerMain.walletId).not.toBe(readerCollection.walletId);
    expect(
      schemas.providerTransferExpectation.safeParse(readerExpected).success
    ).toBe(true);
  });

  it('builds the live record bound to the collect leg', () => {
    expect(readerLiveRecord('successful').data).toMatchObject({
      third_party_reference: readerReference,
      amount: readerExpected.amountKobo,
      source_wallet: readerMain.walletId,
      destination_wallet: readerCollection.walletId,
      status: 'successful',
      fee: 0,
    });
  });

  it('applies overrides on top of the live record', () => {
    const record = readerLiveRecord('pending', { fee: 1500, category: 'x' });
    expect(record.data).toMatchObject({
      status: 'pending',
      fee: 1500,
      category: 'x',
    });
    expect(record.status).toBe(true);
  });
});
