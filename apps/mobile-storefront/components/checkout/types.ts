export type DeliveryMethod = 'door' | 'airport' | 'pickup_station';
export type ShippingQuoteDeliveryPreference = 'door' | 'pickup_station';

export interface ShippingQuote {
  id: string | number;
  displayName: string;
  price: number;
  carrierName?: string;
  provider?: string;
  estimatedDays?: number;
  deliveryRange?: string;
  serviceTier?: string;
  isStationPickup?: boolean;
  /** Receiver street sent with this quote request, separate from station display metadata. */
  receiverAddress?: string;
  /** Station metadata normalized for checkout display. */
  stationName?: string;
  stationAddress?: string;
  stationCode?: string;
  /** Provider booking metadata retained for shipment creation. */
  pickupStationName?: string;
  pickupStationAddress?: string;
  pickupStationCode?: string;
}
