import type { OrderCreateInput } from '@/schemas/orders';
import { normalizeNigerianQuoteReceiver } from './normalize-nigerian-quote-receiver';

type OrderShippingAddress = OrderCreateInput['shipping_address'];

export function normalizeMerchantRateOrderAddress(
  shippingAddress: OrderShippingAddress,
  isMerchantRateOrder: boolean
): OrderShippingAddress {
  if (
    !isMerchantRateOrder ||
    !shippingAddress?.address ||
    !shippingAddress.city ||
    !shippingAddress.state
  ) {
    return shippingAddress;
  }

  return normalizeNigerianQuoteReceiver(shippingAddress, 'domestic');
}
