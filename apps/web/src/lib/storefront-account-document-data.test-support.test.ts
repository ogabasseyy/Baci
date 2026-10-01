import { describe, expect, it } from 'vitest';
import { createStorefrontDocumentSupabaseMock } from './storefront-account-document-data.test-support';

describe('createStorefrontDocumentSupabaseMock', () => {
  it('provides the customer cancellation RPC contract', async () => {
    const { rpc } = createStorefrontDocumentSupabaseMock();
    await expect(rpc('customer_order_can_cancel')).resolves.toEqual({
      data: true,
      error: null,
    });
  });
});
