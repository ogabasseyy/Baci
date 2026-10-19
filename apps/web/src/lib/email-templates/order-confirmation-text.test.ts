import { describe, expect, it } from 'vitest';
import type { OrderConfirmationData } from './order-confirmation';
import { generateOrderConfirmationText } from './order-confirmation-text';

function baseData(): OrderConfirmationData {
  return {
    documentKind: 'confirmation',
    customerName: 'Ada Buyer',
    orderNumber: 'BAC-001',
    items: [],
    currency: 'NGN',
    subtotal: 20000,
    shippingFee: 1500,
    total: 21500,
    shippingAddress: {
      address: '12 Market St',
      city: 'Lagos',
      state: 'Lagos',
      phone: '08010000000',
    },
    merchantUrl: 'https://store.example.com',
    merchantName: 'Test Store',
  } as never;
}

describe('generateOrderConfirmationText', () => {
  it('renders the confirmation with totals and next steps', () => {
    const text = generateOrderConfirmationText(baseData());

    expect(text).toContain('Order Confirmed!');
    expect(text).toContain('Hi Ada Buyer,');
    expect(text).toContain('Order Number: #BAC-001');
    expect(text).toContain('Visit Store: https://store.example.com');
  });

  it('renders the proforma heading for proforma documents', () => {
    const text = generateOrderConfirmationText({
      ...baseData(),
      documentKind: 'proforma',
    });

    expect(text).toContain('Proforma Invoice');
    expect(text).not.toContain('Order Confirmed!');
  });
});
