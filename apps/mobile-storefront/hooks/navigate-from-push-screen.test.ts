import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { logger } from '@/lib/logger';
import { resolveActiveCustomerId } from '@/lib/resolve-active-customer-id';
import {
  clearWalletFundingIntent,
  consumeWalletFundingIntent,
} from '@/lib/wallet-funding-intent';
import { navigateFromPushScreen } from './navigate-from-push-screen';

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
}));

jest.mock('@/lib/wallet-funding-intent', () => ({
  clearWalletFundingIntent: jest.fn(),
  consumeWalletFundingIntent: jest.fn(),
}));

jest.mock('@/lib/resolve-active-customer-id', () => ({
  resolveActiveCustomerId: jest.fn(),
}));

const push = router.push as jest.MockedFunction<typeof router.push>;
const consumeIntent = consumeWalletFundingIntent as jest.MockedFunction<
  typeof consumeWalletFundingIntent
>;
const clearIntent = clearWalletFundingIntent as jest.MockedFunction<
  typeof clearWalletFundingIntent
>;
const resolveCustomerId = resolveActiveCustomerId as jest.MockedFunction<
  typeof resolveActiveCustomerId
>;

/** Lets the fire-and-forget storage read inside the wallet branch settle. */
const _flushIntentRead = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('navigateFromPushScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    consumeIntent.mockResolvedValue(undefined);
    clearIntent.mockResolvedValue(true);
    resolveCustomerId.mockResolvedValue('customer-1');
  });

  it('routes to a specific order when an id is provided', () => {
    navigateFromPushScreen('order-details', { id: 'order-123' });

    expect(push).toHaveBeenCalledWith('/orders/order-123');
  });

  it('falls back to the orders list when the order id is missing', () => {
    navigateFromPushScreen('order-details');

    expect(push).toHaveBeenCalledWith('/orders');
  });

  it('routes repair notification targets to the repairs screen', () => {
    navigateFromPushScreen('repairs', { id: 'repair-123' });

    expect(push).toHaveBeenCalledWith('/repairs');
  });

  it('routes to a product when a slug is provided', () => {
    navigateFromPushScreen('product', { slug: 'iphone-13' });

    expect(push).toHaveBeenCalledWith('/product/iphone-13');
  });

  it('falls back to home when the product slug is missing', () => {
    navigateFromPushScreen('product', {});

    expect(push).toHaveBeenCalledWith('/');
  });

  it('falls back to home when the category slug is missing', () => {
    navigateFromPushScreen('category');

    expect(push).toHaveBeenCalledWith('/');
  });

  it('opens the savings wallet panel for savings actions', () => {
    navigateFromPushScreen('wallet', { action: 'savings' });

    expect(push).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: { action: 'savings' },
    });
  });

  it('sends a named goal through the ownership-checking goal link route', () => {
    navigateFromPushScreen('wallet', {
      action: 'savings',
      savingsGoalId: 'goal-older',
    });

    expect(push).toHaveBeenCalledWith({
      pathname: '/wallet/savings/goal-actions',
      params: { goalId: 'goal-older' },
    });
  });

  it('drops a blank reminder goal before opening the savings panel', () => {
    navigateFromPushScreen('wallet', {
      action: 'savings',
      savingsGoalId: '   ',
    });

    expect(push).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: { action: 'savings' },
    });
  });

  it('opens the plain wallet for non-savings wallet actions', () => {
    navigateFromPushScreen('wallet', {});

    expect(push).toHaveBeenCalledWith('/wallet');
  });

  it('lands on the wallet then resumes the interrupted purchase for wallet-credited taps', () => {
    navigateFromPushScreen('wallet', {
      credited: 'true',
      returnTo: '/checkout',
    });

    // Wallet first (back returns there), destination on top — the tap
    // actually resumes the flow instead of stranding the customer.
    expect(push).toHaveBeenNthCalledWith(1, '/wallet');
    expect(push).toHaveBeenNthCalledWith(2, '/checkout');
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('resumes an allowlisted utility flow with its repeat params', () => {
    navigateFromPushScreen('wallet', {
      credited: 'true',
      returnTo: '/utilities/airtime?repeatAmount=500',
    });

    expect(push).toHaveBeenNthCalledWith(1, '/wallet');
    expect(push).toHaveBeenNthCalledWith(
      2,
      '/utilities/airtime?repeatAmount=500'
    );
    expect(push).toHaveBeenCalledTimes(2);
  });
});
