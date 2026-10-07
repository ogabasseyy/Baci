import { openSavingsFirstCardBrowser } from './savings-first-card-browser';

const mockOpenBrowserAsync = jest.fn();
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
}));

beforeEach(() => mockOpenBrowserAsync.mockReset());

it('opens only validated Paystack checkout URLs in the external browser', async () => {
  await openSavingsFirstCardBrowser('https://checkout.paystack.com/access123');
  expect(mockOpenBrowserAsync).toHaveBeenCalledWith(
    'https://checkout.paystack.com/access123',
    { showInRecents: true }
  );
  await expect(
    openSavingsFirstCardBrowser('https://evil.example/pay')
  ).rejects.toThrow();
  expect(mockOpenBrowserAsync).toHaveBeenCalledTimes(1);
});
