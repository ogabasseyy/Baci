import { Building2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { AirportDeliveryOptions } from './AirportDeliveryOptions';
import { DeliveryMethodTabs } from './DeliveryMethodTabs';
import { DoorDeliveryQuoteOptions } from './DoorDeliveryQuoteOptions';
import { StationPickupOptions } from './StationPickupOptions';

export function DeliveryOptions({
  tabs,
  station,
  airport,
  door,
}: {
  tabs: ComponentProps<typeof DeliveryMethodTabs>;
  station: ComponentProps<typeof StationPickupOptions>;
  airport: ComponentProps<typeof AirportDeliveryOptions>;
  door: ComponentProps<typeof DoorDeliveryQuoteOptions>;
}) {
  const { deliveryMethod } = tabs;
  return (
    <>
      <fieldset className="mt-6 pt-4 border-t border-gray-100 min-w-0">
        <legend className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">
          How would you like to receive your order?
        </legend>
        <DeliveryMethodTabs {...tabs} />
      </fieldset>
      {deliveryMethod === 'pickup' && (
        <div className="mt-4 bg-gray-50 p-4 rounded-xl border border-gray-100 flex items-start gap-4 animate-in fade-in">
          <div className="bg-white p-2 rounded-lg border border-gray-200">
            <Building2 size={24} className="text-gray-600" />
          </div>
          <div>
            <h4 className="font-bold text-gray-900 text-sm">
              Main Office Pickup
            </h4>
            <p className="text-sm text-gray-600 mt-1">
              Available for pickup at our Ikeja Store. Usually ready within 2
              hours.
            </p>
            <div className="mt-2 text-xs font-mono bg-white inline-block px-2 py-1 rounded border border-gray-200 text-gray-500">
              Pickup closes at 6 PM
            </div>
          </div>
        </div>
      )}

      {deliveryMethod === 'pickup_station' && (
        <StationPickupOptions {...station} />
      )}
      {deliveryMethod === 'airport' && <AirportDeliveryOptions {...airport} />}
      {deliveryMethod === 'door' && <DoorDeliveryQuoteOptions {...door} />}
    </>
  );
}
