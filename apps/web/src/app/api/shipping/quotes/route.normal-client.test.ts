import { expect, it, vi } from 'vitest';
import {
  lagosRatesPayload,
  mockCreateAdminClient,
  mockCreateServerClient,
  mockGetMerchantForApiRequest,
  mockGetQuotes,
  NG_MERCHANT,
  postQuotes,
} from './route.merchant-rates.test-fixtures';

it('quotes synthetic merchant rates through the normal session/RLS client without admin credentials', async () => {
  vi.clearAllMocks();
  mockGetMerchantForApiRequest.mockResolvedValue({ merchantId: 'merchant-1' });
  mockGetQuotes.mockResolvedValue({
    quotes: { featured: [], all: [] },
    sessionId: 'synthetic',
    expiresAt: new Date(Date.now() + 60000),
  });
  const { response } = await postQuotes(
    NG_MERCHANT,
    { ...lagosRatesPayload, shipping_providers: [] },
    { supports_merchant_rates: true }
  );
  expect(response.status).toBe(200);
  expect(mockCreateServerClient).toHaveBeenCalled();
  expect(mockCreateAdminClient).not.toHaveBeenCalled();
});
