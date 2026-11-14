import { changeWalletPin } from './wallet-pin-change-api';

const mockFetchJson = jest.fn();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-store' } }) },
}));

const input = { currentPin: '1234', newPin: '987654' };

describe('changeWalletPin', () => {
  beforeEach(() => mockFetchJson.mockReset());

  it('posts exactly the two PINs with CSRF for the pinned user', async () => {
    mockFetchJson.mockResolvedValue({ ok: true });
    await changeWalletPin(input, 'user-1');
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(mockFetchJson).toHaveBeenCalledWith({
      path: '/api/storefront/customer/wallet-pin/change',
      method: 'POST',
      includeCsrf: true,
      expectedUserId: 'user-1',
      body: { currentPin: '1234', newPin: '987654' },
    });
  });

  it('falls back to the signed-in user when none is pinned', async () => {
    mockFetchJson.mockResolvedValue({ ok: true });
    await changeWalletPin(input);
    expect(mockFetchJson.mock.calls[0][0].expectedUserId).toBe('user-store');
  });

  it('throws a generic error without PIN text for an unreadable reply', async () => {
    mockFetchJson.mockResolvedValue({ nope: true });
    const error = await changeWalletPin(input, 'user-1').catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Wallet PIN is unavailable right now.');
    expect(error.message).not.toMatch(/1234|987654/);
  });

  it('rejects malformed PINs locally without a request', async () => {
    const error = await changeWalletPin(
      { currentPin: '12', newPin: '987654' },
      'user-1'
    ).catch((e) => e);
    expect(error.message).not.toMatch(/987654/);
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('keeps the code on a thrown server error', async () => {
    mockFetchJson.mockRejectedValue(
      Object.assign(new Error('That PIN is not right.'), {
        code: 'PIN_INCORRECT',
      })
    );
    await expect(changeWalletPin(input, 'user-1')).rejects.toMatchObject({
      code: 'PIN_INCORRECT',
      message: 'That PIN is not right.',
    });
  });
});
