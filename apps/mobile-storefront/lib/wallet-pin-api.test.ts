import { createHash } from 'node:crypto';
import {
  fetchWalletPinStatus,
  submitWalletPin,
  verifyFundPin,
  verifyGoalActionPin,
} from './wallet-pin-api';

const mockFetchJson = jest.fn();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-a' } }) },
}));

const proof = createHash('sha256').update('s5m-proof').digest('hex');
const ids = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
};

beforeEach(() => jest.clearAllMocks());

describe('fetchWalletPinStatus', () => {
  it('reads the status route for the signed-in user', async () => {
    const status = {
      primary: true,
      hasPin: false,
      resetRequired: false,
      available: true,
    };
    mockFetchJson.mockResolvedValue(status);
    await expect(fetchWalletPinStatus()).resolves.toEqual(status);
    expect(mockFetchJson).toHaveBeenCalledWith({
      path: '/api/storefront/customer/wallet-pin/status',
      expectedUserId: 'user-a',
    });
  });

  it('rejects an unreadable answer instead of guessing', async () => {
    mockFetchJson.mockResolvedValue({ primary: true });
    await expect(fetchWalletPinStatus()).rejects.toThrow('unavailable');
  });
});

describe('submitWalletPin', () => {
  it.each([
    'set',
    'reset',
  ] as const)('posts the PIN to %s only', async (kind) => {
    mockFetchJson.mockResolvedValue({ ok: true });
    await submitWalletPin(kind, '4821');
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/storefront/customer/wallet-pin/${kind}`,
        method: 'POST',
        includeCsrf: true,
        body: { pin: '4821' },
      })
    );
  });

  it('keeps the server error code and copy', async () => {
    mockFetchJson.mockRejectedValue(
      Object.assign(new Error('A PIN is already set.'), {
        code: 'PIN_ALREADY_SET',
      })
    );
    await expect(submitWalletPin('set', '4821')).rejects.toMatchObject({
      code: 'PIN_ALREADY_SET',
      message: 'A PIN is already set.',
    });
  });
});

describe('verifyFundPin', () => {
  const input = { ...ids, pin: '4821', amountKobo: 250000 };

  it('binds the fund action to goal, operation and amount and returns the proof', async () => {
    mockFetchJson.mockResolvedValue({ proof, expiresAt: 'soon' });
    await expect(verifyFundPin(input)).resolves.toBe(proof);
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/storefront/customer/savings/goal-pin/verify',
        method: 'POST',
        includeCsrf: true,
        expectedUserId: 'user-a',
        body: { ...input, action: 'fund' },
      })
    );
  });

  it('refuses a malformed proof', async () => {
    mockFetchJson.mockResolvedValue({ proof: 'short', expiresAt: 'soon' });
    await expect(verifyFundPin(input)).rejects.toThrow('unavailable');
  });

  it('never sends a PIN that is not 4 to 6 digits', async () => {
    await expect(verifyFundPin({ ...input, pin: '12' })).rejects.toThrow();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});

describe('pinned to the account that opened the sheet', () => {
  it('sends the given user id, not whoever is signed in now', async () => {
    mockFetchJson.mockResolvedValue({ ok: true });
    await submitWalletPin('set', '4821', 'user-opened');
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUserId: 'user-opened' })
    );
    mockFetchJson.mockResolvedValue({
      primary: true,
      hasPin: true,
      resetRequired: false,
      available: true,
    });
    await fetchWalletPinStatus('user-opened');
    expect(mockFetchJson).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedUserId: 'user-opened' })
    );
  });

  it('a verify for another account is refused by the client before any request', async () => {
    mockFetchJson.mockRejectedValue(new Error('account changed'));
    await expect(
      verifyFundPin({ ...ids, pin: '4821', amountKobo: 1 }, 'user-opened')
    ).rejects.toThrow('account changed');
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUserId: 'user-opened' })
    );
  });
});

describe('verifyGoalActionPin', () => {
  it.each([
    'cancel',
    'complete',
  ] as const)('verifies the %s action with no amount', async (action) => {
    mockFetchJson.mockResolvedValue({
      proof,
      expiresAt: '2026-11-05T10:00:00Z',
    });
    await expect(
      verifyGoalActionPin({ ...ids, pin: '4821', action }, 'user-opened')
    ).resolves.toBe(proof);
    expect(mockFetchJson).toHaveBeenCalledWith({
      path: '/api/storefront/customer/savings/goal-pin/verify',
      method: 'POST',
      includeCsrf: true,
      expectedUserId: 'user-opened',
      body: { ...ids, pin: '4821', action },
    });
    expect(mockFetchJson.mock.calls[0]?.[0].body).not.toHaveProperty(
      'amountKobo'
    );
  });

  it('rejects a fund action and an unreadable answer before trusting it', async () => {
    await expect(
      verifyGoalActionPin({ ...ids, pin: '4821', action: 'fund' as never })
    ).rejects.toBeDefined();
    expect(mockFetchJson).not.toHaveBeenCalled();
    mockFetchJson.mockResolvedValue({ proof: 'short' });
    await expect(
      verifyGoalActionPin({ ...ids, pin: '4821', action: 'cancel' })
    ).rejects.toThrow('unavailable');
  });

  it('keeps the server code for a wrong PIN', async () => {
    mockFetchJson.mockRejectedValue(
      Object.assign(new Error('That PIN is not right.'), {
        code: 'PIN_INCORRECT',
      })
    );
    await expect(
      verifyGoalActionPin({ ...ids, pin: '0000', action: 'complete' })
    ).rejects.toMatchObject({ code: 'PIN_INCORRECT' });
  });
});
