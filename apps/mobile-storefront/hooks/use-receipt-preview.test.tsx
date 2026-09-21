import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useReceiptPreview } from './use-receipt-preview';

let mockReceiptDetail: Record<string, unknown> | null = null;

jest.mock('./use-receipts', () => ({
  useMerchantReceiptInfo: () => ({
    data: {
      business_name: 'Baci Store',
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
      bank_code: '999',
      bank_account_number: '1234567890',
      bank_name: 'Baci Bank',
      bank_account_name: 'Baci Store Ltd',
      social_media: null,
      pages: null,
    },
  }),
  useReceiptDetail: () => ({ data: mockReceiptDetail }),
}));

function unpaidProformaDetail(currency: string): Record<string, unknown> {
  return {
    id: 'order-1',
    order_number: 'ORD-1',
    created_at: '2026-09-01T10:00:00.000Z',
    currency,
    total: 500,
    subtotal: 500,
    shipping_fee: 0,
    tax_amount: 0,
    discount_amount: 0,
    amount_paid: 0,
    balance: 500,
    payment_status: 'unpaid',
    payment_method: 'invoice',
    is_credit_order: false,
    customer_name: 'Ada Buyer',
    customer_email: 'ada@example.com',
    customer_phone: null,
    shipping_address: null,
    virtual_account: null,
    items: [],
    transactions: [],
  };
}

describe('useReceiptPreview foreign-currency bank details', () => {
  it('omits the NGN merchant account from USD previews', () => {
    mockReceiptDetail = unpaidProformaDetail('USD');
    const { result } = renderHook(() => useReceiptPreview());

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.html).not.toContain('1234567890');
    expect(result.current.html).not.toContain('Baci Bank');
  });

  it('keeps the merchant account for NGN previews', () => {
    mockReceiptDetail = unpaidProformaDetail('NGN');
    const { result } = renderHook(() => useReceiptPreview());

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.html).toContain('1234567890');
  });
});
