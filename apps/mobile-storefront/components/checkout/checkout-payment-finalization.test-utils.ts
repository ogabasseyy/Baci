import { jest } from '@jest/globals';
import type { OrderResponse } from '@/services/orders';

export const mockClearAndPersistCheckoutCart =
  jest.fn<(clearCart: () => void | Promise<void>) => Promise<void>>();
export const mockFetch =
  jest.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >();
export const mockRouterPush = jest.fn();
export const mockRouterReplace = jest.fn();
export const mockStartWalletFundedBankTransferCheckout =
  jest.fn<(params: unknown) => Promise<boolean>>();

jest.mock('expo-router', () => ({
  router: {
    push: mockRouterPush,
    replace: mockRouterReplace,
  },
}));

jest.mock('@/services/orders', () => ({
  OrderError: class OrderError extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('./checkout-cart-persistence', () => ({
  clearAndPersistCheckoutCart: (clearCart: () => void | Promise<void>) =>
    mockClearAndPersistCheckoutCart(clearCart),
}));

jest.mock('./checkout-screen.constants', () => ({
  CHECKOUT_API_BASE_URL: 'https://api.example.com',
  CHECKOUT_MERCHANT_ID: 'merchant-1',
}));

jest.mock('./checkout-wallet-funded-bank-transfer', () => ({
  startWalletFundedBankTransferCheckout: (params: unknown) =>
    mockStartWalletFundedBankTransferCheckout(params),
}));

type OrderResponseOverrides = Omit<
  Partial<OrderResponse>,
  'order' | 'savings' | 'wallet'
> & {
  order?: Partial<OrderResponse['order']>;
  savings?: Partial<NonNullable<OrderResponse['savings']>> | null;
  wallet?: Partial<NonNullable<OrderResponse['wallet']>> | null;
};

const baseOrderResponse: OrderResponse = {
  amountDueToGateway: 25000,
  order: {
    created_at: '2026-05-30T12:00:00.000Z',
    id: 'order-1',
    order_number: 'BAC-001',
    payment_status: 'pending',
    shipping_status: 'pending',
    total: 25000,
    tracking_token: 'tracking-token',
  },
  savings: null,
  wallet: null,
};

export function createOrderResponse(
  overrides: OrderResponseOverrides = {}
): OrderResponse {
  return {
    ...baseOrderResponse,
    ...overrides,
    order: {
      ...baseOrderResponse.order,
      ...overrides.order,
    },
    savings:
      overrides.savings === undefined || overrides.savings === null
        ? (overrides.savings ?? baseOrderResponse.savings)
        : {
            amountUsed: 0,
            goalId: 'goal-1',
            redemptionId: null,
            ...overrides.savings,
          },
    wallet:
      overrides.wallet === undefined || overrides.wallet === null
        ? (overrides.wallet ?? baseOrderResponse.wallet)
        : {
            amountUsed: 0,
            newBalance: 0,
            transactionId: null,
            ...overrides.wallet,
          },
  };
}
