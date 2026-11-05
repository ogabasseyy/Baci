import { changeWalletPin } from './wallet-pin-change-api';

const mockFetchJson = jest.fn();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));

describe('changeWalletPin when the server keeps PiggyVest off', () => {
  it('treats a primary:false reply as unreadable, never as a saved PIN', async () => {
    mockFetchJson.mockResolvedValue({ primary: false, available: false });
    await expect(
      changeWalletPin({ currentPin: '1234', newPin: '5678' }, 'user-1')
    ).rejects.toThrow('Wallet PIN is unavailable right now.');
  });
});
