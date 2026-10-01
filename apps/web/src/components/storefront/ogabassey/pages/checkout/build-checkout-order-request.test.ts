import { expect, it } from 'vitest';
import {
  buildCheckoutOrderRequest,
  type CheckoutOrderRequestInput,
} from './build-checkout-order-request';

const input: CheckoutOrderRequestInput = {
  merchantId: 'merchant-1',
  items: [],
  paymentMethod: 'card',
  acceptsMarketing: false,
  customer: {
    name: 'Ada Okon',
    email: 'ada@example.test',
    phone: '+2348031234567',
  },
  money: {
    subtotal: 1000,
    shipping: 100,
    tax: 75,
    giftWrapping: 50,
    discountAmount: 25,
    discountCode: 'SAVE',
    useWalletCredit: true,
    walletAmount: 300,
  },
  delivery: {
    method: 'door',
    airportType: 'delivery',
    quoteMatchesMethod: true,
    selectedQuoteId: 'quote-1',
    merchantRateId: null,
    provider: 'GIGL',
    address: {
      address: '1 Test Road',
      city: 'Ikeja',
      state: 'Lagos',
      phone: '+2348031234567',
      countryCode: 'NG',
      country: 'Nigeria',
    },
  },
};
it('sends the full parity total including tax, gift wrapping and discount before wallet credit', () => {
  expect(buildCheckoutOrderRequest(input)).toMatchObject({
    expected_total: 1200,
    client_total: 1200,
    tax_amount: 75,
    gift_wrapping_fee: 50,
    discount_code: 'SAVE',
    wallet_amount: 300,
    use_wallet_credit: true,
    accepts_marketing: false,
    selected_quote_id: 'quote-1',
  });
});
it('sends merchant rate identity without a synthetic carrier quote', () => {
  expect(
    buildCheckoutOrderRequest({
      ...input,
      delivery: {
        ...input.delivery,
        selectedQuoteId: 'mrate_rate-1',
        merchantRateId: 'rate-1',
        provider: null,
      },
    })
  ).toMatchObject({
    shipping_rate_id: 'rate-1',
    shipping_provider: null,
    selected_quote_id: null,
  });
});
it('forwards airport quotes only when they match the current delivery method', () => {
  const airport = { ...input.delivery, method: 'airport' as const };
  expect(
    buildCheckoutOrderRequest({ ...input, delivery: airport })
  ).toMatchObject({ selected_quote_id: 'quote-1' });
  expect(
    buildCheckoutOrderRequest({
      ...input,
      delivery: { ...airport, quoteMatchesMethod: false },
    })
  ).toMatchObject({ selected_quote_id: null, airport_type: 'delivery' });
});
