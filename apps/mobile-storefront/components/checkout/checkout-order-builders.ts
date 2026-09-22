import {
  getPickupStationAddressText,
  isProviderStationPickupQuote,
} from '@/components/checkout/checkout-station-pickup';
import { isGiglGoFasterQuote } from '@/components/checkout/checkout-step-helpers';
import type {
  DeliveryMethod,
  ShippingQuote,
} from '@/components/checkout/types';
import { getCartItemEffectivePrice } from '@/lib/cart-pricing';
import type { MobileCheckoutOrderItemPayload } from '@/lib/checkout-order-idempotency';
import type { ShippingAddressInput } from '@/lib/validation';
import type { CreateOrderRequest } from '@/services/orders';
import type { CartItem } from '@/stores/cart-store';

export interface CheckoutSnapshot {
  assuranceFee: number;
  deliveryFee: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

interface BuildOrderRequestParams {
  address: ShippingAddressInput;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  deliveryMethod: DeliveryMethod;
  discountCode?: string | null;
  itemsSnapshot: CartItem[];
  paymentMethodForOrder: string;
  selectedQuote: ShippingQuote | undefined;
  shippingProvider: string | undefined;
  snapshot: CheckoutSnapshot;
}

type CheckoutOrderRequest = Omit<CreateOrderRequest, 'items'> & {
  items: MobileCheckoutOrderItemPayload[];
};

const MERCHANT_RATE_QUOTE_ID_PREFIX = 'mrate_';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getMerchantRateId(
  selectedQuote: ShippingQuote | undefined
): string | undefined {
  if (
    selectedQuote?.provider !== 'MERCHANT' ||
    typeof selectedQuote.id !== 'string' ||
    !selectedQuote.id.startsWith(MERCHANT_RATE_QUOTE_ID_PREFIX)
  ) {
    return undefined;
  }

  const rateId = selectedQuote.id.slice(MERCHANT_RATE_QUOTE_ID_PREFIX.length);
  return UUID_PATTERN.test(rateId) ? rateId : undefined;
}

export function createCheckoutSnapshot(
  itemsSnapshot: CartItem[],
  deliveryFee: number,
  taxAmount: number
): CheckoutSnapshot {
  const subtotal = itemsSnapshot.reduce((total, item) => {
    const effectivePrice = getCartItemEffectivePrice(item);
    return total + effectivePrice * item.quantity;
  }, 0);
  const assuranceFee = calculateCheckoutAssuranceFee(itemsSnapshot);
  return {
    assuranceFee,
    deliveryFee,
    subtotal,
    taxAmount,
    total: subtotal + deliveryFee + assuranceFee + taxAmount,
  };
}

export function calculateCheckoutAssuranceFee(itemsSnapshot: CartItem[]) {
  return itemsSnapshot.reduce((sum, item) => {
    if (!item.hasAssurance) return sum;
    const effectivePrice = getCartItemEffectivePrice(item);
    return (
      sum +
      Math.round(effectivePrice * item.quantity * (item.assuranceRate ?? 0.05))
    );
  }, 0);
}

export function buildOrderShippingAddress(
  address: ShippingAddressInput,
  deliveryMethod: DeliveryMethod,
  selectedQuote?: ShippingQuote
): ShippingAddressInput {
  if (deliveryMethod === 'pickup_station') {
    if (isProviderStationPickupQuote(selectedQuote)) {
      return {
        ...address,
        address: getPickupStationAddressText(selectedQuote),
      };
    }

    return address;
  }

  if (deliveryMethod === 'airport') {
    return {
      ...address,
      address: address.address || 'Airport Delivery (Outside Lagos)',
    };
  }

  return address;
}

export function mapCartItemsToOrderItems(
  itemsSnapshot: CartItem[]
): MobileCheckoutOrderItemPayload[] {
  return itemsSnapshot.map((item) => {
    const effectivePrice = getCartItemEffectivePrice(item);
    return {
      id: item.product_id,
      product_id: item.product_id,
      name: item.name,
      quantity: item.quantity,
      price: effectivePrice,
      condition: item.condition,
      image_url: item.image_url,
      variant_id: item.variant_id,
      variant_name: item.variant_name,
      variant_attributes: item.variant_attributes,
      has_assurance: item.hasAssurance || false,
      assurance_fee: item.hasAssurance
        ? Math.round(
            effectivePrice * item.quantity * (item.assuranceRate ?? 0.05)
          )
        : 0,
      // Quiz prize voucher lines: /api/orders verifies the signed token and
      // compares `condition` against the value baked into it — dropping these
      // here silently broke mobile prize redemption at checkout.
      ...(item.voucher_token !== undefined
        ? { voucher_token: item.voucher_token }
        : {}),
      ...(item.voucher_award_id !== undefined
        ? { voucher_award_id: item.voucher_award_id }
        : {}),
    };
  });
}

export function buildCheckoutOrderRequest({
  address,
  customerEmail,
  customerName,
  customerPhone,
  deliveryMethod,
  discountCode,
  itemsSnapshot,
  paymentMethodForOrder,
  selectedQuote,
  shippingProvider,
  snapshot,
}: BuildOrderRequestParams): CheckoutOrderRequest {
  const isMerchantRateQuote = selectedQuote?.provider === 'MERCHANT';
  const merchantRateId = getMerchantRateId(selectedQuote);
  if (isMerchantRateQuote && !merchantRateId) {
    throw new Error(
      'The selected merchant delivery option is invalid. Please refresh shipping options.'
    );
  }
  const canUseCarrierQuote =
    !isMerchantRateQuote &&
    selectedQuote?.id != null &&
    ((deliveryMethod === 'door' &&
      !isProviderStationPickupQuote(selectedQuote)) ||
      (deliveryMethod === 'airport' && isGiglGoFasterQuote(selectedQuote)) ||
      (deliveryMethod === 'pickup_station' &&
        isProviderStationPickupQuote(selectedQuote)));

  return {
    customer_email: customerEmail,
    customer_name: customerName,
    customer_phone: customerPhone,
    items: mapCartItemsToOrderItems(itemsSnapshot),
    subtotal: snapshot.subtotal,
    shipping_fee: snapshot.deliveryFee,
    tax_amount: snapshot.taxAmount,
    delivery_method: deliveryMethod,
    ...(deliveryMethod === 'airport' && !isGiglGoFasterQuote(selectedQuote)
      ? { airport_type: 'delivery' as const }
      : {}),
    selected_quote_id:
      selectedQuote && canUseCarrierQuote
        ? String(selectedQuote.id)
        : undefined,
    ...(merchantRateId ? { shipping_rate_id: merchantRateId } : {}),
    shipping_provider: isMerchantRateQuote ? undefined : shippingProvider,
    payment_method: paymentMethodForOrder,
    shipping_address: buildOrderShippingAddress(
      address,
      deliveryMethod,
      selectedQuote
    ),
    // Intentionally omit expected_total/client_total here: the web order API
    // derives and validates the final payable total at the tax boundary.
    source: 'mobile_app',
    // Only the trusted code string; the route recomputes + validates the amount.
    ...(discountCode ? { discount_code: discountCode } : {}),
  };
}
