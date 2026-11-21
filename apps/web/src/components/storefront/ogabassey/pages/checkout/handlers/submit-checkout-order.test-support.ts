import { buildCheckoutOrderRequest } from '../build-checkout-order-request';

export function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

export function orderRequest() {
  return buildCheckoutOrderRequest({
    merchantId: 'merchant-1',
    items: [],
    paymentMethod: 'card',
    acceptsMarketing: false,
    customer: {
      name: 'Ada Customer',
      email: 'customer@example.com',
      phone: '08000000000',
    },
    money: {
      subtotal: 4200,
      shipping: 0,
      tax: 0,
      giftWrapping: 0,
      discountAmount: 0,
      useWalletCredit: false,
      walletAmount: 0,
    },
    delivery: {
      method: 'pickup',
      airportType: 'delivery',
      quoteMatchesMethod: false,
      selectedQuoteId: '',
      merchantRateId: null,
      provider: null,
      address: {
        address: 'Store',
        city: 'Lagos',
        state: 'Lagos',
        phone: '',
        countryCode: 'NG',
        country: 'Nigeria',
      },
    },
  });
}
