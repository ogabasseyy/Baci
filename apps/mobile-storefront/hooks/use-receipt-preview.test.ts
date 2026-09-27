import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { createElement, useEffect } from 'react';
import { Text, View } from 'react-native';
import type { MerchantReceiptInfo, ReceiptDetail } from '@/types/receipt';

const mockUseMerchantReceiptInfo = jest.fn();
const mockUseReceiptDetail = jest.fn();

jest.mock('./use-receipts', () => ({
  useMerchantReceiptInfo: (...args: unknown[]) =>
    mockUseMerchantReceiptInfo(...args),
  useReceiptDetail: (...args: unknown[]) => mockUseReceiptDetail(...args),
}));

const merchantFixture: MerchantReceiptInfo = {
  business_name: 'Baci',
  logo_url: null,
  email: 'merchant@example.com',
  phone: null,
  support_email: null,
  support_phone: null,
  business_address: null,
  cac_rc_number: null,
  tax_identification_number: null,
  legal_entity_name: null,
  brand_colors: null,
  vat_registration_status: null,
  vat_rate: null,
  bank_code: null,
  bank_account_number: null,
  bank_name: null,
  bank_account_name: null,
  social_media: null,
  pages: null,
};

const detailFixture: ReceiptDetail = {
  id: 'order-1',
  order_number: 'ORD-1',
  payment_status: 'paid',
  payment_method: 'bank_transfer',
  total: 15000,
  subtotal: 15000,
  shipping_fee: 0,
  discount_amount: 0,
  tax_amount: 0,
  amount_paid: 15000,
  balance: 0,
  currency: 'NGN',
  is_credit_order: false,
  created_at: '2024-01-10T10:00:00.000Z',
  transaction_date: '2024-02-03T10:00:00.000Z',
  invoice_issue_date: '2024-02-05',
  notes: null,
  customer_name: 'Ada',
  customer_email: 'customer@example.com',
  customer_phone: null,
  shipping_address: null,
  items: [
    {
      id: 'item-1',
      product_name: 'Widget',
      quantity: 1,
      price: 15000,
    },
  ],
  virtual_account: null,
  transactions: [],
};

describe('useReceiptPreview', () => {
  it('passes the issue date through to the generated receipt HTML', async () => {
    const { useReceiptPreview } = await import('./use-receipt-preview');
    mockUseMerchantReceiptInfo.mockReturnValue({ data: merchantFixture });
    mockUseReceiptDetail.mockReturnValue({ data: detailFixture });

    function Probe({ orderId }: { orderId: string }) {
      const preview = useReceiptPreview();
      useEffect(() => {
        preview.openPreviewByOrderId(orderId);
      }, [orderId, preview]);
      return createElement(
        View,
        { testID: 'probe' },
        createElement(Text, { testID: 'html' }, preview.html),
        createElement(
          Text,
          { testID: 'open' },
          preview.isOpen ? 'open' : 'closed'
        )
      );
    }

    const screen = render(createElement(Probe, { orderId: 'order-1' }));

    expect(screen.getByTestId('open').props.children).toBe('open');
    const html = screen.getByTestId('html').props.children as string;
    expect(html).toContain('5 Feb 2024');
    expect(html).not.toContain('3 Feb 2024');
  });
});
