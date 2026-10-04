import { router } from 'expo-router';
import { trackCheckoutPaymentStarted } from '@/services/analytics';
import { getCheckoutAuthorizationHeaders } from '@/services/redvault';
import {
  initializeRedvaultCheckout,
  initializeRedvaultCheckoutById,
} from './initialize-redvault-checkout';
import type { RedvaultReviewInput } from './RedvaultOrderReview';
import { redvaultOrderResponse } from './redvault-order-review.test-utils';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/services/redvault', () => ({
  getCheckoutAuthorizationHeaders: jest.fn(),
}));
jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentStarted: jest.fn(),
}));

it('rejects incomplete persisted summaries before requesting a payment', async () => {
  const input = {
    orderResponse: {},
    customerEmail: 'ada@example.com',
    customerName: 'Ada',
    customerPhone: '08012345678',
  } as RedvaultReviewInput;
  jest.clearAllMocks();
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
  global.fetch = fetchMock;
  try {
    await expect(initializeRedvaultCheckout(input)).rejects.toThrow();
    expect(getCheckoutAuthorizationHeaders).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  } finally {
    global.fetch = originalFetch;
  }
});

function mockSuccessfulInitialize() {
  const originalFetch = global.fetch;
  (getCheckoutAuthorizationHeaders as jest.Mock).mockResolvedValue({});
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      authorization_url: 'https://checkout.paystack.com/test',
      reference: 'RV-test',
    }),
  });
  global.fetch = fetchMock;
  return { originalFetch, fetchMock };
}

it('completes account sync before navigating to the gateway', async () => {
  jest.clearAllMocks();
  const { originalFetch } = mockSuccessfulInitialize();
  const onReady = jest.fn(async () => undefined);
  try {
    await expect(
      initializeRedvaultCheckoutById({
        orderId: 'order-rv',
        customerEmail: 'ada@example.com',
        customerName: 'Ada',
        customerPhone: '08012345678',
        onReady,
      })
    ).resolves.toBe('ready');
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(onReady.mock.invocationCallOrder[0]).toBeLessThan(
      (router.push as jest.Mock).mock.invocationCallOrder[0]
    );
  } finally {
    global.fetch = originalFetch;
  }
});

it('opens the funnel attempt once the provider reference returns', async () => {
  jest.clearAllMocks();
  const { originalFetch } = mockSuccessfulInitialize();
  try {
    await expect(
      initializeRedvaultCheckoutById({
        orderId: 'order-rv',
        customerEmail: 'ada@example.com',
        customerName: 'Ada',
        customerPhone: '08012345678',
        amount: '5750',
      })
    ).resolves.toBe('ready');
    // The review path bypasses finalizeCheckoutPayment: without this
    // start, the later provider-verified completion would dangle.
    expect(trackCheckoutPaymentStarted).toHaveBeenCalledTimes(1);
    expect(trackCheckoutPaymentStarted).toHaveBeenCalledWith({
      orderId: 'order-rv',
      paymentMethod: 'uba_redvault',
      reference: 'RV-test',
      value: 5750,
    });
    expect(
      (trackCheckoutPaymentStarted as jest.Mock).mock.invocationCallOrder[0]
    ).toBeLessThan((router.push as jest.Mock).mock.invocationCallOrder[0]);
  } finally {
    global.fetch = originalFetch;
  }
});

it('sends the order tracking token as guest initialization proof', async () => {
  jest.clearAllMocks();
  const { originalFetch, fetchMock } = mockSuccessfulInitialize();
  try {
    await initializeRedvaultCheckoutById({
      orderId: 'order-rv',
      customerEmail: 'ada@example.com',
      customerName: 'Ada',
      customerPhone: '08012345678',
      trackingToken: 'track-rv',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tracking_token).toBe('track-rv');
  } finally {
    global.fetch = originalFetch;
  }
});

it('runs the review success callback before navigating on the fresh path', async () => {
  jest.clearAllMocks();
  const { originalFetch } = mockSuccessfulInitialize();
  const onInitializationSuccess = jest.fn(async () => undefined);
  try {
    await expect(
      initializeRedvaultCheckout({
        orderResponse: redvaultOrderResponse,
        customerEmail: 'ada@example.com',
        customerName: 'Ada',
        customerPhone: '08012345678',
        onInitializationSuccess,
      } as unknown as RedvaultReviewInput)
    ).resolves.toBe('ready');
    expect(onInitializationSuccess).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(onInitializationSuccess.mock.invocationCallOrder[0]).toBeLessThan(
      (router.push as jest.Mock).mock.invocationCallOrder[0]
    );
  } finally {
    global.fetch = originalFetch;
  }
});
