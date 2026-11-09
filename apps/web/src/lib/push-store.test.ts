import { describe, expect, it } from 'vitest';
import type { PushStore } from './push-store';

describe('PushStore contract', () => {
  it('lets a restricted worker implement delivery persistence without a database client', async () => {
    const store: PushStore = {
      deactivateTokens: async () => ({ error: null }),
      fetchCustomerTokens: async () => ({ data: [], error: null }),
      fetchMerchantTokens: async () => ({ data: [], error: null }),
      insertAttempt: async () => ({ error: null }),
      insertTickets: async () => ({ error: null }),
    };

    await expect(
      store.fetchMerchantTokens({ merchantId: 'm' })
    ).resolves.toEqual({
      data: [],
      error: null,
    });
  });
});
