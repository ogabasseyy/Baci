import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fetchPiggyvestWalletActivity } from './piggyvest-wallet-activity';

const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('PiggyVest wallet activity client with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the server refusal through as an error, never a partial list', async () => {
    mockFetchJson.mockRejectedValue(
      Object.assign(new Error('off'), { code: 'PIGGYVEST_NOT_READY' })
    );
    await expect(
      fetchPiggyvestWalletActivity({ merchantId: MERCHANT })
    ).rejects.toThrow('off');
  });

  it('sends the store, the cursor and the expected user', async () => {
    mockFetchJson.mockResolvedValue({ items: [], nextCursor: null });
    await fetchPiggyvestWalletActivity({
      merchantId: MERCHANT,
      userId: 'customer-1',
      cursor: 'abc_DEF-1',
    });
    expect(mockFetchJson).toHaveBeenCalledWith({
      path: `/api/storefront/customer/wallet/piggyvest-activity?merchantId=${MERCHANT}&cursor=abc_DEF-1`,
      expectedUserId: 'customer-1',
    });
  });

  it('rejects an answer carrying internal fields', async () => {
    mockFetchJson.mockResolvedValue({
      items: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'bank_transfer',
          direction: 'in',
          amountKobo: 100,
          feeKobo: 0,
          label: 'Money added',
          status: 'completed',
          occurredAt: '2026-11-13T10:00:00Z',
          reference: 'pvb-secret',
        },
      ],
      nextCursor: null,
    });
    await expect(
      fetchPiggyvestWalletActivity({ merchantId: MERCHANT })
    ).rejects.toThrow('We couldn’t load your wallet activity.');
  });
});
