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
const flushIntentRead = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('navigateFromPushScreen: wallet funding intent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    consumeIntent.mockResolvedValue(undefined);
    clearIntent.mockResolvedValue(true);
    resolveCustomerId.mockResolvedValue('customer-1');
  });

  it('drops a malicious returnTo and falls back to the bare wallet', async () => {
    const maliciousReturnTos = [
      '//evil.com',
      '/../secrets',
      '%2f%2fevil',
      // Open-redirect chain: an internal redirector that would forward the tap
      // to an attacker destination via its own returnTo.
      '/auth/callback?returnTo=//evil.com',
      '/auth/callback?returnTo=https://evil.com',
      // Nested redirect params on an otherwise allowlisted destination.
      '/checkout?redirect=//evil.com',
      '/checkout?next=/auth/callback',
      '/checkout%3FreturnTo=%2F%2Fevil.com',
      // Non-resumable internal routes are not push destinations at all.
      '/settings',
      '/utilities/crypto',
    ];
    for (const returnTo of maliciousReturnTos) {
      navigateFromPushScreen('wallet', { credited: 'true', returnTo });
    }
    await flushIntentRead();

    for (const call of push.mock.calls) {
      expect(call[0]).toBe('/wallet');
    }
    expect(push).toHaveBeenCalledTimes(maliciousReturnTos.length);
  });

  it('resumes the locally stored funding intent when the credit carries no returnTo', async () => {
    // Bank-transfer/DVA credits: the transaction is created by the webhook, so
    // it can never carry a returnTo. The intent recorded when the customer
    // opened the funding surface is the only surviving destination.
    consumeIntent.mockResolvedValue('/utilities/power?repeatAmount=2000');

    navigateFromPushScreen('wallet', { credited: 'true' });
    await flushIntentRead();

    expect(push).toHaveBeenNthCalledWith(1, '/wallet');
    expect(push).toHaveBeenNthCalledWith(
      2,
      '/utilities/power?repeatAmount=2000'
    );
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('stays on the wallet when no funding intent is stored', async () => {
    navigateFromPushScreen('wallet', { credited: 'true' });
    await flushIntentRead();

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/wallet');
  });

  it('falls back to the stored intent when the payload returnTo is rejected', async () => {
    consumeIntent.mockResolvedValue('/checkout');

    navigateFromPushScreen('wallet', {
      credited: 'true',
      returnTo: '//evil.com',
    });
    await flushIntentRead();

    expect(push).toHaveBeenNthCalledWith(1, '/wallet');
    expect(push).toHaveBeenNthCalledWith(2, '/checkout');
  });

  it('clears the stored intent when the payload carries a valid returnTo', async () => {
    navigateFromPushScreen('wallet', {
      credited: 'true',
      returnTo: '/checkout',
    });
    await flushIntentRead();

    expect(clearIntent).toHaveBeenCalledTimes(1);
    expect(consumeIntent).not.toHaveBeenCalled();
  });

  it('scopes the intent read to the customer signed in at tap time', async () => {
    // Shared device / account switch: the credit belongs to whoever is signed
    // in now, so the intent lookup is keyed by that customer and a previous
    // customer's leftover intent can never be resumed.
    resolveCustomerId.mockResolvedValue('customer-2');
    consumeIntent.mockResolvedValue(undefined);

    navigateFromPushScreen('wallet', { credited: 'true' });
    await flushIntentRead();

    expect(consumeIntent).toHaveBeenCalledWith(
      'customer-2',
      expect.any(Function)
    );
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/wallet');
  });

  it('does not consume the intent when no active customer can be resolved', async () => {
    resolveCustomerId.mockResolvedValue(undefined);
    consumeIntent.mockResolvedValue(undefined);

    navigateFromPushScreen('wallet', { credited: 'true' });
    await flushIntentRead();

    expect(consumeIntent).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('handles an unexpected resume failure without an unhandled rejection', async () => {
    resolveCustomerId.mockRejectedValue(new Error('auth unavailable'));

    navigateFromPushScreen('wallet', { credited: 'true' });
    await flushIntentRead();

    expect(logger.warn).toHaveBeenCalledWith(
      'PushNavigation',
      'Failed to resume wallet funding intent:',
      expect.any(Error)
    );
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/wallet');
  });

  it('does not touch the funding intent for savings taps', async () => {
    navigateFromPushScreen('wallet', { action: 'savings' });
    await flushIntentRead();

    expect(consumeIntent).not.toHaveBeenCalled();
    expect(clearIntent).not.toHaveBeenCalled();
  });

  it('does not consume the funding intent for a non-credit wallet push', async () => {
    // Regression: `vtu_cashback_monthly_summary` also targets the wallet with no
    // params, which made it indistinguishable from a returnTo-less credit. It
    // used to consume the single-use intent — misfiring a navigation AND burning
    // the intent, so the real credit that followed resumed nothing.
    consumeIntent.mockResolvedValue('/checkout');

    navigateFromPushScreen('wallet', {});
    await flushIntentRead();

    expect(consumeIntent).not.toHaveBeenCalled();
    expect(clearIntent).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/wallet');
  });

  it('defaults the utility-history type to power when unspecified', () => {
    navigateFromPushScreen('utility-history');

    expect(push).toHaveBeenCalledWith('/utilities/history?type=power');
  });

  it('routes carrier-unlock notifications to unlock orders', () => {
    navigateFromPushScreen('unlock-orders');

    expect(push).toHaveBeenCalledWith('/unlock-orders');
  });

  it('routes unknown screens to home', () => {
    navigateFromPushScreen('unknown-screen');

    expect(push).toHaveBeenCalledWith('/');
  });
});
