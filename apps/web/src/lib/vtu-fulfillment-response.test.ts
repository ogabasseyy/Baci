import { describe, expect, it } from 'vitest';
import type { FulfilledVtuResult } from '@/lib/vtu-fulfillment';
import { mapFulfillmentToResponse } from './vtu-fulfillment-response';

describe('mapFulfillmentToResponse', () => {
  it('maps a failed fulfillment to a 400 with the error and refund', async () => {
    const fulfillment: FulfilledVtuResult = {
      amount: 1000,
      error: 'Vend failed',
      reference: 'REF-FAIL',
      refundedToWallet: 1000,
      status: 'failed',
    };

    const response = mapFulfillmentToResponse(fulfillment);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Vend failed',
      reference: 'REF-FAIL',
      refundedToWallet: 1000,
    });
  });

  it('omits refundedToWallet when the failure did not refund', async () => {
    const fulfillment: FulfilledVtuResult = {
      amount: 1000,
      error: 'Vend failed',
      reference: 'REF-FAIL',
      status: 'failed',
    };

    const response = mapFulfillmentToResponse(fulfillment);

    expect(await response.json()).toEqual({
      error: 'Vend failed',
      reference: 'REF-FAIL',
    });
  });

  it('maps a processing fulfillment to a 202', async () => {
    const fulfillment: FulfilledVtuResult = {
      amount: 1000,
      reference: 'REF-PROC',
      status: 'processing',
    };

    const response = mapFulfillmentToResponse(fulfillment);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      reference: 'REF-PROC',
      status: 'processing',
    });
  });

  it('maps a successful fulfillment with cashback and voucher pin', async () => {
    const fulfillment: FulfilledVtuResult = {
      amount: 1000,
      cashback: { amount: 50, credited: true, newBalance: 4500 },
      customerIdentifier: '08012345678',
      reference: 'REF-OK',
      status: 'successful',
      voucherPin: '1234',
    };

    const response = mapFulfillmentToResponse(fulfillment);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      amount: 1000,
      cashback: { amount: 50, credited: true, newBalance: 4500 },
      customerIdentifier: '08012345678',
      reference: 'REF-OK',
      status: 'successful',
      voucherPin: '1234',
    });
  });
});
