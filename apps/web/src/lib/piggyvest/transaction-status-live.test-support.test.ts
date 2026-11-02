import { describe, expect, it } from 'vitest';
import { piggyvestTransactionStatusSchemas as schemas } from '@/schemas/piggyvest-transaction-status';
import {
  jsonResponse,
  liveJustSubmittedNotFound,
  liveTransactionStatus,
  liveUnknownReferenceNotFound,
} from './transaction-status-live.test-support';

const binding = {
  reference: 'pvb-save-00000000-0000-4000-8000-000000000002',
  amountKobo: 10000,
  sourceWalletId: 'synthetic-source-wallet',
  destinationWalletId: 'synthetic-goal-wallet',
  customerId: 'synthetic-customer',
};

describe('live TSQ fixtures', () => {
  it.each([
    'pending',
    'successful',
    'failed',
  ] as const)('builds a %s record bound to the transfer, with no currency field', (status) => {
    const live = liveTransactionStatus(binding, status);
    expect(live.data).toMatchObject({
      status,
      third_party_reference: binding.reference,
      amount: binding.amountKobo,
      fee: 0,
      customer_id: binding.customerId,
      source_wallet: binding.sourceWalletId,
      destination_wallet: binding.destinationWalletId,
    });
    expect('currency' in live.data).toBe(false);
    expect(live.data.reference).not.toBe(binding.reference);
    expect(schemas.walletTransferResponse.safeParse(live).success).toBe(true);
  });

  it('keeps the two 404 bodies identical apart from processing_status', () => {
    expect(liveUnknownReferenceNotFound).toEqual({
      status: false,
      message: 'Transaction Not Found',
      data: {},
    });
    expect(liveJustSubmittedNotFound).toEqual({
      ...liveUnknownReferenceNotFound,
      data: { processing_status: 'processing' },
    });
  });

  it('serves JSON with the requested HTTP status', async () => {
    const response = jsonResponse(liveJustSubmittedNotFound, 404);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual(liveJustSubmittedNotFound);
  });
});
