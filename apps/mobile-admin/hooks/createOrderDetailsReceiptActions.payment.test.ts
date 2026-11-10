import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiClient: vi.fn(),
  resolveVirtualAccount: vi.fn(),
}));

vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));
vi.mock('@/lib/query-client', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@/lib/api-client', () => ({ apiClient: mocks.apiClient }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  },
}));
vi.mock('./resolveOrderReceiptLogo', () => ({
  resolveOrderReceiptLogo: async () => ({ logoUrl: null }),
}));
vi.mock('./resolveOrderReceiptVirtualAccount', () => ({
  resolveOrderReceiptVirtualAccount: mocks.resolveVirtualAccount,
}));

import { createOrderDetailsReceiptActions } from './createOrderDetailsReceiptActions';

it('shows the directory bank as manual confirmation when a DVA is unavailable', async () => {
  mocks.resolveVirtualAccount.mockResolvedValueOnce(null);
  mocks.apiClient.mockResolvedValueOnce({
    banks: [{ code: '50211', name: 'Kuda Bank' }],
  });
  const setIsGeneratingReceipt = vi.fn();
  const setReceiptHtml = vi.fn();
  const setShowReceiptPreview = vi.fn();

  const actions = createOrderDetailsReceiptActions({
    isGeneratingReceipt: false,
    merchant: {
      business_name: 'Baci',
      email: 'merchant@example.com',
      id: 'merchant-1',
      bank_code: '50211',
      bank_name: 'Unknown Bank',
      bank_account_number: '1234567890',
    },
    order: {
      amount_paid: 0,
      balance: 15000,
      created_at: '2024-01-01T00:00:00.000Z',
      customer_email: 'customer@example.com',
      customer_name: 'Ada',
      customer_phone: '08030000000',
      discount_amount: 0,
      id: 'order-1',
      items: [],
      order_number: 'ORD-1',
      payment_status: 'pending',
      shipping_address: null,
      shipping_status: 'pending',
      total: 15000,
      updated_at: '2024-01-01T00:00:00.000Z',
    },
    receiptHtml: '',
    setIsGeneratingReceipt,
    setReceiptHtml,
    setShowReceiptPreview,
  });

  await actions.handleSendReceipt();
  expect(setReceiptHtml.mock.calls[0]?.[0]).toContain('Manual Confirmation');
  expect(setReceiptHtml.mock.calls[0]?.[0]).toContain('Kuda Bank');
  expect(setReceiptHtml.mock.calls[0]?.[0]).not.toContain(
    'Automatic Confirmation'
  );

  expect(setIsGeneratingReceipt).toHaveBeenNthCalledWith(1, true);
  expect(setReceiptHtml).toHaveBeenCalledWith(expect.any(String));
  expect(setShowReceiptPreview).toHaveBeenCalledWith(true);
  expect(setIsGeneratingReceipt).toHaveBeenLastCalledWith(false);
});
