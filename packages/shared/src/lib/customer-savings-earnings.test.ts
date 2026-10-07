import { describe, expect, it } from 'vitest';
import {
  type CustomerSavingsEarningsRpcClient,
  fetchCustomerSavingsEarningsKobo,
} from './customer-savings-earnings';

function createClient(
  response: Promise<{ data: unknown; error: unknown }>
): CustomerSavingsEarningsRpcClient {
  return {
    rpc: async () => response,
  };
}

describe('fetchCustomerSavingsEarningsKobo', () => {
  it('returns the canonical credited-interest kobo value', async () => {
    await expect(
      fetchCustomerSavingsEarningsKobo({
        client: createClient(
          Promise.resolve({
            data: { credited_interest_kobo: 12_550 },
            error: null,
          })
        ),
        merchantId: 'merchant-1',
      })
    ).resolves.toBe(12_550);
  });

  it('treats RPC errors, malformed payloads, and rejections as unavailable', async () => {
    await expect(
      fetchCustomerSavingsEarningsKobo({
        client: createClient(
          Promise.resolve({ data: null, error: { code: 'PGRST202' } })
        ),
        merchantId: 'merchant-1',
      })
    ).resolves.toBeNull();
    await expect(
      fetchCustomerSavingsEarningsKobo({
        client: createClient(
          Promise.resolve({ data: { credited_interest_kobo: -1 }, error: null })
        ),
        merchantId: 'merchant-1',
      })
    ).resolves.toBeNull();
    await expect(
      fetchCustomerSavingsEarningsKobo({
        client: createClient(Promise.reject(new Error('Network unavailable'))),
        merchantId: 'merchant-1',
      })
    ).resolves.toBeNull();
  });
});
