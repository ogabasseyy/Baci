import { jest } from '@jest/globals';
import * as WebBrowser from 'expo-web-browser';
import { openWalletPaystackCheckout } from './open-wallet-paystack-checkout';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

describe('openWalletPaystackCheckout', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens the original Paystack checkout URL', async () => {
    const url = 'https://checkout.paystack.com/access-code?source=wallet';
    await openWalletPaystackCheckout(url);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(url);
  });

  it.each([
    'https://checkout.paystack.com.evil.example/session',
    'http://checkout.paystack.com/session',
    'https://customer@checkout.paystack.com/session',
    'https://checkout.paystack.com:444/session',
    'not-a-url',
  ])('refuses an unsafe checkout URL: %s', async (url) => {
    await expect(openWalletPaystackCheckout(url)).rejects.toThrow();
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
});
