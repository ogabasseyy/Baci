import { describe, expect, it } from 'vitest';
import { getStorefrontAccountDocumentData } from '@/lib/storefront-account-document-data';
import { createStorefrontDocumentSupabaseMock } from './storefront-account-document-data.test-support';

describe('storefront account document cancellation status', () => {
  it('surfaces can_cancel from the customer_order_can_cancel RPC', async () => {
    const { supabase, rpc } = createStorefrontDocumentSupabaseMock({
      canCancelResult: { data: true, error: null },
    });

    const result = await getStorefrontAccountDocumentData({
      supabase,
      userId: 'user-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
    });

    expect(rpc).toHaveBeenCalledWith('customer_order_can_cancel', {
      p_order_id: 'order-1',
    });
    expect(result.order.can_cancel).toBe(true);
  });

  it('defaults can_cancel to false when the RPC returns false', async () => {
    const { supabase } = createStorefrontDocumentSupabaseMock({
      canCancelResult: { data: false, error: null },
    });

    const result = await getStorefrontAccountDocumentData({
      supabase,
      userId: 'user-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
    });

    expect(result.order.can_cancel).toBe(false);
  });

  it('treats an RPC error as not cancellable (fail-closed)', async () => {
    const { supabase } = createStorefrontDocumentSupabaseMock({
      canCancelResult: { data: null, error: { message: 'rpc failed' } },
    });

    const result = await getStorefrontAccountDocumentData({
      supabase,
      userId: 'user-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
    });

    expect(result.order.can_cancel).toBe(false);
  });
});
