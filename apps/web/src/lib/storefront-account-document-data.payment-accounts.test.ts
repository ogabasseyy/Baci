import { describe, expect, it } from 'vitest';
import { getStorefrontAccountDocumentData } from './storefront-account-document-data';
import { createStorefrontDocumentSupabaseMock } from './storefront-account-document-data.test-support';

describe('storefront account document payment accounts', () => {
  it('uses a legacy account when the Paystack document alias has expired', async () => {
    const { supabase } = createStorefrontDocumentSupabaseMock({
      paymentAccounts: [
        {
          account_name: 'Expired Paystack',
          account_number: '1111111111',
          assigned_at: '2026-07-08T11:00:00.000Z',
          bank_name: 'Paystack',
          expires_at: '2026-07-08T12:30:00.000Z',
          provider: 'paystack',
        },
        {
          account_name: 'Legacy',
          account_number: '2222222222',
          bank_name: 'Korapay',
          provider: 'korapay',
        },
      ],
    });
    const result = await getStorefrontAccountDocumentData({
      supabase,
      userId: 'user-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
    });
    expect(result.order.virtual_account?.account_number).toBe('2222222222');
  });

  it('uses the DVA recorded on the paid transaction when aliases are historical', async () => {
    const { supabase } = createStorefrontDocumentSupabaseMock({
      orderPatch: { payment_status: 'paid' },
      paymentAccounts: [
        {
          account_name: 'Paid DVA',
          account_number: '1111111111',
          assigned_at: '2026-07-08T11:00:00.000Z',
          bank_name: 'Paystack',
          created_at: '2026-07-08T11:00:00.000Z',
          expires_at: '2026-07-08T12:30:00.000Z',
          provider: 'paystack',
        },
        {
          account_name: 'Newer DVA',
          account_number: '2222222222',
          assigned_at: '2026-07-08T12:00:00.000Z',
          bank_name: 'Paystack',
          created_at: '2026-07-08T12:00:00.000Z',
          expires_at: '2026-07-08T13:30:00.000Z',
          provider: 'paystack',
        },
      ],
      transactions: [
        {
          amount: 100000,
          created_at: '2026-07-08T12:45:00.000Z',
          description: 'Paystack DVA payment',
          gateway: 'paystack',
          metadata: { dva_account_number: '1111111111' },
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
    });

    const result = await getStorefrontAccountDocumentData({
      supabase,
      userId: 'user-1',
      merchantSlug: 'ogabassey',
      orderId: 'order-1',
    });

    expect(result.order.virtual_account?.account_number).toBe('1111111111');
  });
});
