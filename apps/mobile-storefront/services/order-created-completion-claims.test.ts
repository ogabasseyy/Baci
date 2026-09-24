import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import { trackCheckoutOrderCreated } from '@/services/analytics';
import type { CreateOrderRequest, OrderResponse } from './orders.schemas';
import { trackCreatedOrderOnce } from './orders-analytics';

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockStorage.set(key, value);
    },
  },
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));
jest.mock('@/services/analytics', () => ({
  trackCheckoutOrderCreated: jest.fn(),
}));

const mockTrackCreated = trackCheckoutOrderCreated as jest.Mock;

function buildOrder(): OrderResponse {
  return {
    order: {
      id: 'order-claim-flow',
      order_number: 'BAC-CLAIM',
      payment_status: 'pending',
      total: 21500,
    },
  } as unknown as OrderResponse;
}

function buildRequest(): CreateOrderRequest {
  return {
    items: [{ product_id: 'product-1', quantity: 1 }],
    payment_method: 'uba_redvault',
    shipping_fee: 0,
    subtotal: 21500,
    tax_amount: 0,
  } as unknown as CreateOrderRequest;
}

describe('order-created to completion claim flow', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
  });

  it('leaves the purchase claim free after creation so completion can emit and clear its context', async () => {
    await trackCreatedOrderOnce(
      buildOrder(),
      buildRequest(),
      Date.now(),
      'uba_redvault'
    );
    expect(mockTrackCreated).toHaveBeenCalledTimes(1);

    // The creation holds its own scoped key...
    await expect(
      claimCheckoutPurchaseTracking('order-claim-flow', 'order_created')
    ).resolves.toBe(false);

    // ...while the legacy bare purchase key used by the verified
    // completion path stays free: creation must not suppress the purchase
    // emission (whose branch also clears the saved REDVAULT context).
    await expect(
      claimCheckoutPurchaseTracking('order-claim-flow')
    ).resolves.toBe(true);
  });
});
