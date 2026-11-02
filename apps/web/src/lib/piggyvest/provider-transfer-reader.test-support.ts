import { liveTransactionStatus } from './transaction-status-live.test-support';

/**
 * Shared synthetic binding for the provider transfer reader suites: a
 * collect leg from a customer's main wallet into the Collection house
 * wallet, both registered in NGN.
 */
export const readerReference = 'pvb-wt-00000000-0000-4000-8000-0000000000a1-1';
export const readerCustomerId = '01JBSYNTHETICCUSTOMER00001';
export const readerMain = {
  walletId: '01JBSYNTHETICMAINWALLET001',
  currency: 'NGN',
  role: 'main',
} as const;
export const readerCollection = {
  walletId: '01JBSYNTHETICCOLLECTION001',
  currency: 'NGN',
  role: 'collection',
} as const;
export const readerFeeWallet = {
  walletId: '01JBSYNTHETICFEEWALLET0001',
  currency: 'NGN',
} as const;
export const readerExpected = {
  amountKobo: 25000,
  source: readerMain,
  destination: readerCollection,
};

/** #3896's live TSQ record for the collect leg, with field overrides. */
export function readerLiveRecord(
  status: 'pending' | 'successful' | 'failed',
  change: Record<string, unknown> = {}
) {
  const body = liveTransactionStatus(
    {
      reference: readerReference,
      amountKobo: readerExpected.amountKobo,
      sourceWalletId: readerMain.walletId,
      destinationWalletId: readerCollection.walletId,
      customerId: readerCustomerId,
    },
    status
  );
  return { ...body, data: { ...body.data, ...change } };
}
