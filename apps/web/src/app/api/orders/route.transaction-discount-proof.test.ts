import { beforeEach, describe, expect, it } from 'vitest';
import {
  createOrderRequest,
  failTransactionDiscountProofSigning,
  getLatestRpc,
  omitNegotiationDiscountAllocations,
  POST,
  resetOrderRouteMocks,
} from './route.transaction-discount-fixtures.test-support';

describe('POST /api/orders transaction discount proof', () => {
  beforeEach(() => {
    resetOrderRouteMocks();
  });

  it('fails closed when transaction discount provenance signing is unavailable', async () => {
    failTransactionDiscountProofSigning();

    const response = await POST(createOrderRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'TRANSACTION_DISCOUNT_PROOF_UNAVAILABLE',
      error: 'Unable to create order right now. Please try again.',
    });
    expect(getLatestRpc()).not.toHaveBeenCalled();
  });

  it('omits transaction discount metadata when no line allocations exist', async () => {
    omitNegotiationDiscountAllocations();

    const response = await POST(createOrderRequest());

    expect(response.status).toBe(201);
    const adTracking = getLatestRpc().mock.calls[0]?.[1]?.p_ad_tracking;
    expect(adTracking?.baci_transaction_discount).toBeUndefined();
  });
});
