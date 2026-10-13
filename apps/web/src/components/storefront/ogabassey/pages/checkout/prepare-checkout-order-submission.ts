import type { CheckoutOrderItem } from '@/lib/checkout/build-order-items';
import type { SavedAddress, DeliveryMethod, PaymentMethod } from './types';
import type { ShippingQuote } from '@/types/shipping-quote';
import { prepareCheckoutDelivery } from './handlers/prepare-checkout-delivery';
import type { PreparedCheckoutDelivery } from './handlers/prepare-checkout-delivery';
import { prepareCheckoutOrderIdentity } from './prepare-checkout-order-identity';
import { isAirportDeliveryReady } from './is-airport-delivery-ready';
import { isKlumpUnavailableForGatewayAmount } from './utils';

export interface PrepareCheckoutOrderSubmissionOptions {
  payment: {
    method: PaymentMethod;
    bankTransferAvailable: boolean;
    paystackAvailable: boolean;
    korapayAvailable: boolean;
    redvaultAvailable: boolean;
    remainingAmount: number;
    total: number;
  };
  delivery: {
    method: DeliveryMethod;
    selectedQuoteId: string;
    selectedQuoteMatchesMethod: boolean;
    airportRequiresQuote: boolean;
    airportType: 'delivery' | 'pickup';
    quotes: ShippingQuote[];
    addresses: SavedAddress[];
    selectedAddressId: number | null;
    isNewAddressMode: boolean;
    newAddressStreet: string;
    newAddressCity: string;
    newAddressState: string;
    customerPhone: string;
    merchantCountry: string;
    deliveryCost: number;
  };
  identity: {
    merchantId: string;
    customerEmail: string;
    customerName: string;
    customerPhone: string;
    checkoutItems: CheckoutOrderItem[];
    useWalletCredit: boolean;
    walletAmountUsed: number;
    discountCode?: string | null;
    giftWrappingCost: number;
  };
}

export type PrepareCheckoutOrderSubmissionResult =
  | {
      kind: 'issue';
      issue:
        | 'delivery-option'
        | 'bank-transfer-unavailable'
        | 'paystack-unavailable'
        | 'korapay-unavailable'
        | 'redvault-unavailable'
        | 'klump-unavailable'
        | 'incomplete-address'
        | 'delivery-required'
        | 'shipping-expired';
    }
  | {
      kind: 'ready';
      delivery: {
        address: PreparedCheckoutDelivery['address'];
        finalAddress: string;
        finalCity: string;
        finalState: string;
        merchantRateId: string | null;
        shippingProvider: string | null;
      };
      identity: ReturnType<typeof prepareCheckoutOrderIdentity>;
    };

/** Validate the selected payment/delivery path, then freeze delivery and order identity for this submit. */
export function prepareCheckoutOrderSubmission({
  payment,
  delivery,
  identity,
}: PrepareCheckoutOrderSubmissionOptions): PrepareCheckoutOrderSubmissionResult {
  if (
    ((delivery.method === 'door' || delivery.method === 'pickup_station') &&
      !delivery.selectedQuoteId) ||
    (delivery.method === 'airport' &&
      !isAirportDeliveryReady(
        delivery.airportRequiresQuote,
        delivery.selectedQuoteMatchesMethod
      ))
  ) {
    return { kind: 'issue', issue: 'delivery-option' };
  }
  if (
    payment.method === 'bank_transfer' &&
    !payment.bankTransferAvailable
  ) {
    return { kind: 'issue', issue: 'bank-transfer-unavailable' };
  }
  if (payment.method === 'paystack' && !payment.paystackAvailable) {
    return { kind: 'issue', issue: 'paystack-unavailable' };
  }
  if (payment.method === 'korapay' && !payment.korapayAvailable) {
    return { kind: 'issue', issue: 'korapay-unavailable' };
  }
  if (payment.method === 'uba_redvault' && !payment.redvaultAvailable) {
    return { kind: 'issue', issue: 'redvault-unavailable' };
  }
  if (
    isKlumpUnavailableForGatewayAmount({
      paymentMethod: payment.method,
      payableAmount: payment.remainingAmount,
      orderAmount: payment.total,
    })
  ) {
    return { kind: 'issue', issue: 'klump-unavailable' };
  }

  const selectedAddress = delivery.addresses.find(
    (address) => address.id === delivery.selectedAddressId
  );
  const preparedDelivery = prepareCheckoutDelivery({
    method: delivery.method,
    selectedQuoteId: delivery.selectedQuoteId,
    selectedQuoteMatchesMethod: delivery.selectedQuoteMatchesMethod,
    airportRequiresQuote: delivery.airportRequiresQuote,
    quotes: delivery.quotes,
    selectedAddress,
    isNewAddressMode: delivery.isNewAddressMode,
    newAddressStreet: delivery.newAddressStreet,
    newAddressCity: delivery.newAddressCity,
    newAddressState: delivery.newAddressState,
    airportType: delivery.airportType,
    customerPhone: delivery.customerPhone,
    merchantCountry: delivery.merchantCountry,
  });
  if (preparedDelivery.issue === 'incomplete-address') {
    return { kind: 'issue', issue: 'incomplete-address' };
  }
  if (preparedDelivery.issue === 'required') {
    return { kind: 'issue', issue: 'delivery-required' };
  }
  if (preparedDelivery.issue === 'expired') {
    return { kind: 'issue', issue: 'shipping-expired' };
  }

  const address = preparedDelivery.address;
  const { address: finalAddress, city: finalCity, state: finalState } = address;
  return {
    kind: 'ready',
    delivery: {
      address,
      finalAddress,
      finalCity,
      finalState,
      merchantRateId: preparedDelivery.merchantRateId,
      shippingProvider: preparedDelivery.provider,
    },
    identity: prepareCheckoutOrderIdentity({
      paymentMethod: payment.method,
      merchantId: identity.merchantId,
      customerEmail: identity.customerEmail,
      customerName: identity.customerName,
      customerPhone: identity.customerPhone,
      deliveryMethod: delivery.method,
      shippingFee: delivery.deliveryCost,
      shippingProvider: preparedDelivery.provider,
      selectedQuoteId:
        delivery.method === 'door' ||
        delivery.method === 'pickup_station' ||
        (delivery.method === 'airport' &&
          delivery.selectedQuoteMatchesMethod)
          ? delivery.selectedQuoteId || undefined
          : undefined,
      shippingAddress: address,
      items: identity.checkoutItems,
      useWalletCredit: identity.useWalletCredit,
      walletAmountUsed: identity.walletAmountUsed,
      discountCode: identity.discountCode,
      giftWrappingCost: identity.giftWrappingCost,
    }),
  };
}
