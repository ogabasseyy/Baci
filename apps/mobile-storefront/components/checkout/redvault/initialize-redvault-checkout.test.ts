import { router } from 'expo-router';
import { getCheckoutAuthorizationHeaders } from '@/services/redvault';
import { initializeRedvaultCheckout } from './initialize-redvault-checkout';
import type { RedvaultReviewInput } from './RedvaultOrderReview';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/services/redvault', () => ({
  getCheckoutAuthorizationHeaders: jest.fn(),
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
