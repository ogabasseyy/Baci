import * as WebBrowser from 'expo-web-browser';
import { openRepairPickupPayment } from './open-repair-pickup-payment';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
describe('openRepairPickupPayment', () => {
  beforeEach(() => jest.clearAllMocks());
  it('opens the Paystack checkout URL', async () => {
    await openRepairPickupPayment('https://checkout.paystack.com/ref');
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1);
  });
  it.each([
    undefined,
    'http://checkout.paystack.com/ref',
    'https://evil.com',
    'https://user@checkout.paystack.com/ref',
  ])('rejects unsafe URL %s', async (url) => {
    await expect(openRepairPickupPayment(url)).rejects.toThrow();
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
});
