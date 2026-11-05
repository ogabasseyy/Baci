import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piggyvestPrimaryWalletApi } from './piggyvest-primary-wallet';

const mockFetchJson = jest.fn<(options: unknown) => Promise<unknown>>();

jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({
    fetchJson: (options: unknown) => mockFetchJson(options),
  }),
}));

const MERCHANT = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
});

// The server keeping PiggyVest off answers PIGGYVEST_NOT_READY; the client
// rethrows it untouched so callers keep the legacy flows.
describe('PiggyVest primary wallet client with the server off', () => {
  it('rejects with the server not-ready error and no snapshot', async () => {
    const notReady = Object.assign(new Error('not ready'), {
      code: 'PIGGYVEST_NOT_READY',
    });
    mockFetchJson.mockRejectedValue(notReady);
    await expect(
      piggyvestPrimaryWalletApi.read(MERCHANT, 'user-1')
    ).rejects.toBe(notReady);
  });

  it('rejects an unrecognised answer instead of inventing a balance', async () => {
    mockFetchJson.mockResolvedValue({ unexpected: true });
    await expect(piggyvestPrimaryWalletApi.read(MERCHANT)).rejects.toThrow(
      'Could not confirm your PiggyVest account'
    );
  });

  it('rejects a ready answer with an invalid balance, surfacing no balance', async () => {
    const account = {
      accountName: 'A',
      accountNumber: '0987654321',
      bankName: 'B',
      provider: 'piggyvest',
    };
    for (const balanceKobo of [-1, 10.5, '100']) {
      mockFetchJson.mockResolvedValue({
        status: 'ready',
        account,
        balanceKobo,
      });
      await expect(piggyvestPrimaryWalletApi.read(MERCHANT)).rejects.toThrow(
        'Could not confirm your PiggyVest account'
      );
    }
  });

  it('never sends a create request for invalid details', async () => {
    await expect(
      piggyvestPrimaryWalletApi.create({
        merchantId: MERCHANT,
        bvn: '1',
        consent: false,
      })
    ).rejects.toThrow();
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
