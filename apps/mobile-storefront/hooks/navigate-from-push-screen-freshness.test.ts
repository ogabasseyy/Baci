import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { resolveActiveCustomerId } from '@/lib/resolve-active-customer-id';
import { consumeWalletFundingIntent } from '@/lib/wallet-funding-intent';
import { navigateFromPushScreen } from './navigate-from-push-screen';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/resolve-active-customer-id', () => ({
  resolveActiveCustomerId: jest.fn(),
}));
jest.mock('@/lib/wallet-funding-intent', () => ({
  clearWalletFundingIntent: jest.fn(),
  consumeWalletFundingIntent: jest.fn(),
}));

const push = router.push as jest.MockedFunction<typeof router.push>;
const consumeIntent = consumeWalletFundingIntent as jest.MockedFunction<
  typeof consumeWalletFundingIntent
>;
const resolveCustomerId = resolveActiveCustomerId as jest.MockedFunction<
  typeof resolveActiveCustomerId
>;

describe('navigateFromPushScreen wallet freshness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveCustomerId.mockResolvedValue('customer-1');
  });

  it('waits for intent consumption before navigating', async () => {
    let resolveIntent: ((value: '/checkout') => void) | undefined;
    consumeIntent.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveIntent = resolve;
        })
    );

    const navigation = navigateFromPushScreen('wallet', { credited: 'true' });
    await Promise.resolve();
    expect(push).not.toHaveBeenCalled();

    resolveIntent?.('/checkout');
    await navigation;

    expect(push).toHaveBeenNthCalledWith(1, '/wallet');
    expect(push).toHaveBeenNthCalledWith(2, '/checkout');
  });

  it('passes freshness into consumption and skips stale navigation', async () => {
    let isCurrent = true;
    consumeIntent.mockImplementation(async (_customerId, shouldConsume) => {
      isCurrent = false;
      return shouldConsume?.() ? '/checkout' : undefined;
    });

    await navigateFromPushScreen(
      'wallet',
      { credited: 'true' },
      () => isCurrent
    );

    expect(consumeIntent).toHaveBeenCalledWith(
      'customer-1',
      expect.any(Function)
    );
    expect(push).not.toHaveBeenCalled();
  });
});
