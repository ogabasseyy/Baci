import { describe, expect, it } from 'vitest';
import { buildCheckoutOrderSubmissionOptions } from './build-checkout-order-submission-options';
import { createContext } from './checkout-order-submission.test-support';

describe('buildCheckoutOrderSubmissionOptions', () => {
  it('carries current contact, delivery, payment, and cart values into the submission', () => {
    const context = createContext();
    context.contact.customerEmail = 'new@example.com';
    context.contact.customerPhone = '+2348000000001';
    context.delivery.method = 'door';
    context.delivery.newAddressStreet = '2 Main St';
    context.delivery.session.cost = 1200;
    context.payment.session.method = 'uba_redvault';
    context.payment.session.wallet.amountUsed = 250;
    context.payment.session.checkoutValues.useWalletCredit = true;
    context.cart.checkoutCart = [
      {
        id: 'phone-1',
        cartItemId: 'phone-1',
        name: 'Phone',
        description: '',
        status: 'active',
        quantity: 2,
        price: 10000,
        manage_stock: false,
        stock: 0,
        image: '',
        imageLarge: '',
        imageHint: '',
        brand: '',
        gtin: '',
        mpn: '',
        negotiatedPrice: 9000,
        selectedColor: 'Black',
      },
    ];

    const options = buildCheckoutOrderSubmissionOptions(context, 'merchant-1');

    expect(options.payment).toMatchObject({ method: 'uba_redvault' });
    expect(options.delivery).toMatchObject({
      method: 'door',
      newAddressStreet: '2 Main St',
      customerPhone: '+2348000000001',
      deliveryCost: 1200,
    });
    expect(options.identity).toMatchObject({
      merchantId: 'merchant-1',
      customerEmail: 'new@example.com',
      customerName: 'Ada Okon',
      customerPhone: '+2348000000001',
      useWalletCredit: true,
      walletAmountUsed: 250,
      checkoutItems: [
        {
          product_id: 'phone-1',
          quantity: 2,
          price: 9000,
          value: 18000,
          variantAttributes: { color: 'Black' },
        },
      ],
    });
  });

  it('preserves an empty checkout cart for an existing review', () => {
    const context = createContext();
    expect(
      buildCheckoutOrderSubmissionOptions(context, 'merchant-1').identity
        .checkoutItems
    ).toEqual([]);
  });
});
