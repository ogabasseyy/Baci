import type { ReceiptMerchant, ReceiptOrder } from '@baci/shared/receipt';
import { generateReceiptHtml } from '@baci/shared/receipt';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptModal } from './ReceiptModal';

vi.mock('@baci/shared/receipt', async () => {
  const actual = await vi.importActual<typeof import('@baci/shared/receipt')>(
    '@baci/shared/receipt'
  );

  return {
    ...actual,
    generateReceiptHtml: vi.fn(() => '<html><body>Document</body></html>'),
  };
});

const merchant: ReceiptMerchant = {
  bank_account_number: null,
  bank_code: null,
  business_address: null,
  business_name: 'Baci Store',
  cac_rc_number: null,
  email: 'store@example.com',
  legal_entity_name: null,
  logo_url: null,
  phone: null,
  support_email: null,
  support_phone: null,
  tax_identification_number: null,
  vat_rate: null,
  vat_registration_status: null,
};

function createOrder(paymentStatus: 'paid' | 'pending'): ReceiptOrder {
  return {
    amount_paid: paymentStatus === 'paid' ? 1500 : 0,
    balance: paymentStatus === 'paid' ? 0 : 1500,
    created_at: '2026-04-24T10:00:00Z',
    currency: 'NGN',
    customer_email: 'customer@example.com',
    customer_name: 'Customer',
    customer_phone: null,
    discount_amount: 0,
    items: [{ price: 1500, product_name: 'Phone Case', quantity: 1 }],
    order_number: 'ORD-001',
    payment_method: null,
    payment_status: paymentStatus,
    shipping_fee: 0,
    subtotal: 1500,
    tax_amount: 0,
    total: 1500,
  };
}

describe('ReceiptModal document kind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels and renders the resolved proforma kind for unpaid orders', () => {
    const order = createOrder('pending');
    render(
      <ReceiptModal
        isOpen
        merchantData={merchant}
        onClose={vi.fn()}
        orderData={order}
        documentKind="proforma"
      />
    );

    expect(screen.getByText('Proforma Invoice Details')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Print proforma invoice' })
    ).toBeInTheDocument();
    expect(vi.mocked(generateReceiptHtml)).toHaveBeenCalledWith(
      order,
      merchant,
      { documentKind: 'proforma' }
    );
  });

  it('keeps the commercial receipt when a stale proforma kind travels with a paid order', () => {
    const order = createOrder('paid');
    render(
      <ReceiptModal
        isOpen
        merchantData={merchant}
        onClose={vi.fn()}
        orderData={order}
        documentKind="proforma"
      />
    );

    expect(screen.getByText('Receipt Details')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Print receipt' })
    ).toBeInTheDocument();
  });
});
