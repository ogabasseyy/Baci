import type {
  DeliveryMethod,
  ShippingQuote,
} from '@/components/checkout/types';
import type { ShippingAddressInput } from '@/lib/validation';
import {
  buildSavingsOrderFields,
  buildWalletOrderFields,
  type SavingsSelection,
  type WalletSelection,
} from '@/lib/wallet-payment-helpers';
import type { CreateOrderRequest } from '@/services/orders';
import type { CartItem } from '@/stores/cart-store';
import {
  buildCheckoutOrderRequest,
  type CheckoutSnapshot,
} from './checkout-order-builders';

export type CheckoutSubmitOrderRequestInput = {
  address: ShippingAddressInput;
  appliedDiscountCode?: string | null;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  deliveryMethod: DeliveryMethod;
  itemsSnapshot: CartItem[];
  liveSavingsSelection: SavingsSelection | undefined;
  liveWalletSelection: WalletSelection | undefined;
  paymentMethodForOrder: string;
  selectedQuote: ShippingQuote | undefined;
  shippingProvider: string | undefined;
  snapshot: CheckoutSnapshot;
};

export function buildCheckoutSubmitOrderRequest({
  address,
  appliedDiscountCode,
  customerEmail,
  customerName,
  customerPhone,
  deliveryMethod,
  itemsSnapshot,
  liveSavingsSelection,
  liveWalletSelection,
  paymentMethodForOrder,
  selectedQuote,
  shippingProvider,
  snapshot,
}: CheckoutSubmitOrderRequestInput): {
  creditFields: Record<string, unknown>;
  orderRequest: CreateOrderRequest;
} {
  // The credit fields are returned separately so the submit rollback path
  // can re-freeze them if finalization emptied the cart before failing.
  const creditFields: Record<string, unknown> = {
    ...(appliedDiscountCode
      ? {}
      : buildSavingsOrderFields(liveSavingsSelection)),
    ...buildWalletOrderFields(liveWalletSelection),
  };
  return {
    creditFields,
    orderRequest: {
      ...buildCheckoutOrderRequest({
        address,
        customerEmail,
        customerName,
        customerPhone,
        deliveryMethod,
        discountCode: appliedDiscountCode,
        itemsSnapshot,
        paymentMethodForOrder,
        selectedQuote,
        shippingProvider,
        snapshot,
      }),
      ...creditFields,
    },
  };
}
