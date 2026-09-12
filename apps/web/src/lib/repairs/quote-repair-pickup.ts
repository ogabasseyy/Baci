import { shippingService } from '@/lib/shipping';
import type {
  QuoteRequest,
  ShipmentItem,
  ShippingAddress,
  ShippingQuote,
} from '@/lib/shipping/types';
import type { RepairCenterAddress } from './repair-center-address';
import { REPAIR_PICKUP_PROVIDER } from './repair-pickup-constants';
import { selectRepairPickupQuote } from './select-repair-pickup-quote';

export async function quoteRepairPickup({
  items,
  merchantId,
  receiver,
  sender,
}: {
  items: ShipmentItem[];
  merchantId: string;
  receiver: RepairCenterAddress;
  sender: ShippingAddress;
}): Promise<{ quote: ShippingQuote | null; request: QuoteRequest }> {
  const request: QuoteRequest = {
    sessionId: crypto.randomUUID(),
    merchantId,
    shipmentType: 'domestic',
    sender,
    receiver: {
      name: receiver.name,
      phone: receiver.phone,
      email: receiver.email,
      address: receiver.address,
      city: receiver.city,
      state: receiver.state,
      country: receiver.country,
      countryCode: receiver.countryCode,
    },
    items,
  };
  const quotes = await shippingService.getProviderQuotes(
    REPAIR_PICKUP_PROVIDER,
    request
  );
  return { quote: selectRepairPickupQuote(quotes), request };
}
