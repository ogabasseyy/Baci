import { describe, expect, it } from 'vitest';
import { buildPreGatewayRedemptionFailureResponse } from './pre-gateway-redemption-failure-response';

describe('buildPreGatewayRedemptionFailureResponse', () => {
  it('includes order identity and committed wallet balance when available', async () => {
    const response = buildPreGatewayRedemptionFailureResponse({
      failure: {
        status: 409,
        code: 'STORE_CREDIT_REVIEW_REQUIRED',
        message: 'Store credit requires payment review.',
      },
      order: {
        id: 'order-1',
        orderNumber: 'ORD-101',
        trackingToken: 'tok-123',
      },
      amountDueToGateway: 2500,
      wallet: {
        amountUsed: 500,
        newBalance: 1500,
      },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Store credit requires payment review.',
      code: 'STORE_CREDIT_REVIEW_REQUIRED',
      orderId: 'order-1',
      orderNumber: 'ORD-101',
      trackingToken: 'tok-123',
      amountDueToGateway: 2500,
      wallet: {
        amountUsed: 500,
        newBalance: 1500,
      },
    });
  });

  it('omits non-string tracking tokens and zero-amount wallets', async () => {
    const response = buildPreGatewayRedemptionFailureResponse({
      failure: {
        status: 503,
        code: 'STORE_CREDIT_RETRY_REQUIRED',
        message:
          'Store credit is temporarily busy. Retry the same order shortly.',
      },
      order: {
        id: 'order-2',
        orderNumber: null,
        trackingToken: 12345,
      },
      amountDueToGateway: 1000,
      wallet: {
        amountUsed: 0,
        newBalance: 200,
      },
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Store credit is temporarily busy. Retry the same order shortly.',
      code: 'STORE_CREDIT_RETRY_REQUIRED',
      orderId: 'order-2',
      amountDueToGateway: 1000,
    });
  });
});
