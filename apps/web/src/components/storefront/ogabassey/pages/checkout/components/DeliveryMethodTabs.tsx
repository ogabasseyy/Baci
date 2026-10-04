import { isAirportDeliveryEligible, isPickupEligible } from '@baci/shared';
import { Building2, Plane, Truck } from 'lucide-react';
import type { ShippingQuote } from '@/types/shipping-quote';
import type { DeliveryMethod } from '../types';
import { getPickupStationCopy } from '../utils';

export function DeliveryMethodTabs({
  deliveryMethod,
  newAddressState,
  merchantSlug,
  stationPickupQuote,
  hasMerchantPickupQuote,
  onSelect,
}: {
  deliveryMethod: DeliveryMethod;
  newAddressState: string;
  merchantSlug?: string;
  stationPickupQuote: ShippingQuote | undefined;
  hasMerchantPickupQuote: boolean;
  onSelect: (method: DeliveryMethod) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {(['door', 'airport', 'pickup_station', 'pickup'] as const).map(
        (method) => {
          // Store ships from Lagos: the legacy in-store
          // pickup is Lagos-only and airport is for non-Lagos
          // states with an airport. Shared with the mobile
          // storefront so they can't drift. Exception: a
          // merchant/GIGL station quote reveals the
          // provider-aware pickup_station tab even in Lagos,
          // so merchant-configured pickup rates aren't hidden.
          if (
            method === 'pickup_station' &&
            isPickupEligible(newAddressState) &&
            !stationPickupQuote &&
            !hasMerchantPickupQuote
          ) {
            return null;
          }
          if (
            method === 'pickup' &&
            (merchantSlug !== 'ogabassey' ||
              !isPickupEligible(newAddressState) ||
              hasMerchantPickupQuote)
          ) {
            // Hide the hardcoded in-store pickup once the
            // merchant configures its own pickup rate — the
            // pickup_station tab renders it (avoids a
            // duplicate "Store Pickup" affordance).
            return null;
          }
          if (
            method === 'airport' &&
            !isAirportDeliveryEligible(newAddressState)
          ) {
            return null;
          }

          // Merchant `pickup` rates reuse the station-pickup
          // tab with neutral (non-GIGL) copy.
          const pickupStationCopy = getPickupStationCopy(stationPickupQuote);
          const Icon =
            method === 'door'
              ? Truck
              : method === 'airport'
                ? Plane
                : Building2;
          const label =
            method === 'door'
              ? 'By Road'
              : method === 'pickup_station'
                ? pickupStationCopy.methodLabel
                : method === 'pickup'
                  ? 'Store Pickup'
                  : 'By Air';
          const subtitle =
            method === 'door'
              ? 'To your address'
              : method === 'pickup_station'
                ? pickupStationCopy.methodSubtitle
                : method === 'pickup'
                  ? 'Collect at store'
                  : 'Via air cargo';

          return (
            <button
              type="button"
              key={method}
              onClick={() => onSelect(method)}
              className={`flex-1 flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl border-2 transition-all gap-1 min-w-[100px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-store-primary focus-visible:ring-offset-2 ${
                deliveryMethod === method
                  ? 'border-store-primary bg-store-primary/5 text-store-primary'
                  : 'border-gray-100 bg-white text-gray-500 hover:border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Icon
                className={`size-6 ${deliveryMethod === method ? 'text-store-primary' : 'text-gray-400'}`}
              />
              <span className="text-xs sm:text-sm font-bold">{label}</span>
              <span className="text-[10px] text-gray-400">{subtitle}</span>
            </button>
          );
        }
      )}
    </div>
  );
}
