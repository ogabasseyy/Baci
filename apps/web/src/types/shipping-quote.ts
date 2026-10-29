import type { QuoteProviderCode } from '@/lib/shipping/types';
import type { HomeDeliveryCoverage } from '@/schemas/gigl-address-validation';

export interface ShippingQuote {
  id: string;
  provider: QuoteProviderCode;
  serviceTier: string;
  carrierName: string;
  displayName: string;
  estimatedDays: number;
  deliveryRange?: string;
  minDays?: number;
  maxDays?: number;
  price: number;
  currency: string;
  pickupIncluded: boolean;
  insuranceIncluded: boolean;
  isStationPickup?: boolean;
  homeDeliveryCoverage?: HomeDeliveryCoverage;
  stationName?: string;
  stationAddress?: string;
  // Collection directions for a pickup point (e.g. merchant pickup
  // `pickupAddress.instructions`), surfaced to the shopper before they choose.
  stationInstructions?: string;
  stationCode?: string;
  providerRateId?: string;
}
