import { vi } from 'vitest';
import { createContext } from './checkout-order-submission.test-support';

export function reviewedDelivery(method: 'door' | 'pickup_station') {
  const context = createContext();
  const address = method === 'door' ? '1 main st' : 'yaba station, 3 yaba st';
  const fingerprint = `uba_redvault:${JSON.stringify({
    merchantId: 'merchant-1',
    customerEmail: 'ada@example.com',
    customerName: 'ada okon',
    customerPhone: '+2348000000000',
    deliveryMethod: method,
    shippingFee: 1200,
    shippingProvider: 'gigl',
    merchantRateId: null,
    shippingAddress: {
      address,
      city: 'lagos',
      state: 'lagos',
      phone: '+2348000000000',
    },
    items: [
      {
        product_id: 'phone-1',
        name: 'phone',
        quantity: 1,
        price: 10000,
        variantAttributes: {},
        has_assurance: false,
        assurance_fee: 0,
      },
    ],
    useWalletCredit: false,
    walletAmountUsed: 0,
    discountCode: null,
    giftWrappingCost: 0,
  })}`;
  const ready = {
    cartId: 'old-cart',
    orderId: 'order-1',
    orderNumber: 'UBA-1',
    trackingToken: 'tracking-proof',
    customerEmail: context.contact.customerEmail,
    customerName: 'Ada Okon',
    customerPhone: context.contact.customerPhone,
    checkoutFingerprint: fingerprint,
    billingAddress: {
      line1: address,
      city: 'Lagos',
      state: 'Lagos',
      country: 'NG',
    },
    currency: 'NGN',
    total: 11200,
  };
  const summary = {
    productSubtotalKobo: 1_000_000,
    eligibleSubtotalKobo: 1_000_000,
    ineligibleSubtotalKobo: 0,
    discountKobo: 0,
    assuranceFeeKobo: 0,
    taxKobo: 0,
    shippingKobo: 120_000,
    giftWrappingKobo: 0,
    payableKobo: 1_120_000,
    mixedBasket: false,
  };
  context.resumed.order = null;
  context.resumed.preferredGateway = null;
  context.cart.sharedCartEnabled = true;
  context.cart.sharedCartRef = null;
  context.cart.checkoutCart = [];
  context.delivery.method = method;
  context.delivery.newAddressStreet = '1 Main St';
  context.delivery.newAddressCity = 'Lagos';
  context.delivery.newAddressState = 'Lagos';
  context.delivery.session.validation.isValid = false;
  context.delivery.session.quotes = {
    ...context.delivery.session.quotes,
    selectedId: '',
    matchesSelectedMethod: false,
    items: [],
  };
  context.order.pending = {
    orderId: ready.orderId,
    orderNumber: ready.orderNumber,
    trackingToken: ready.trackingToken,
    merchantId: 'merchant-1',
    customerEmail: ready.customerEmail,
    customerPhone: ready.customerPhone,
    checkoutFingerprint: fingerprint,
    paymentMethod: 'uba_redvault',
    amountDueToGateway: ready.total,
    createdAt: '2026-10-29T00:00:00.000Z',
    redvaultReview: { ready, summary },
  };
  context.payment.session.method = 'uba_redvault';
  context.payment.session.redvault = {
    ...context.payment.session.redvault,
    status: 'idle',
    orderReady: ready,
    setOrderReady: vi.fn(),
    setSummary: vi.fn(),
  };
  vi.mocked(context.account.waitForResolvedCustomerAuth).mockResolvedValue(
    false
  );
  return { context, fingerprint };
}
