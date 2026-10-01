import type { NormalizedShipmentStatus } from './tracking-types';

export type { DeliveryTier, ProviderConfig } from './shipping-config';
export {
  mapToDeliveryTier,
  PROVIDER_CONFIGS,
  TIER_DISPLAY_NAMES,
} from './shipping-config';
export type {
  NormalizedShipmentStatus,
  TrackingEvent,
  TrackingResult,
} from './tracking-types';
export { SHIPMENT_STATUS_LABELS } from './tracking-types';

/**
 * Shipping Provider Types
 * Unified interfaces for GIGL and Topship integration
 */

// =============================================================================
// PROVIDER CODES
// =============================================================================

export const SHIPPING_PROVIDER_CODES = ['GIGL', 'TOPSHIP'] as const;

export type ShippingProviderCode = (typeof SHIPPING_PROVIDER_CODES)[number];

/**
 * A provider returned a definitive rejection for a booking attempt. Unlike a
 * timeout or transport error, this means the caller can safely allow a retry.
 */
export class ShippingBookingRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShippingBookingRejectedError';
  }
}

/**
 * Merchant-configured rates surface as quotes with this provider code.
 *
 * It is intentionally kept OUT of `SHIPPING_PROVIDER_CODES` (and therefore out
 * of `ShippingProviderCode`): that tuple drives carrier-only paths such as
 * `isShippingProviderCode`, quote persistence, and booking. Merchant rates are
 * computed from config and never booked with a carrier, so only the
 * display-facing `ShippingQuote.provider` union is widened to include it.
 */
export const MERCHANT_PROVIDER_CODE = 'MERCHANT' as const;

export type MerchantProviderCode = typeof MERCHANT_PROVIDER_CODE;

/** Provider code for a quote shown to the customer (carrier or merchant). */
export type QuoteProviderCode = ShippingProviderCode | MerchantProviderCode;

// =============================================================================
// ADDRESS TYPES
// =============================================================================

export interface ShippingAddress {
  name: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  state: string;
  country: string;
  countryCode: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  // GIGL-specific
  stationId?: number;
  stationName?: string;
}

// =============================================================================
// ITEM TYPES
// =============================================================================

export interface ShipmentItem {
  name: string;
  quantity: number;
  weight: number; // kg
  value: number; // Naira
  category?: string; // For Topship categories
  hsCode?: string; // For international shipments
  length?: number; // cm, for international volumetric pricing
  width?: number; // cm, for international volumetric pricing
  height?: number; // cm, for international volumetric pricing
  description?: string;
}

// =============================================================================
// QUOTE TYPES
// =============================================================================

export interface QuoteRequest {
  sessionId: string;
  merchantId?: string;
  sender?: ShippingAddress; // Uses merchant address if not provided
  receiver: ShippingAddress;
  items: ShipmentItem[];
  shipmentType: 'domestic' | 'international';
  deliveryPreference?: 'door' | 'pickup_station';
  /** Server-attested provenance for owner-scoped Admin order quotes. */
  admin_order_provenance?: 'server_gigl_v1';
}

export interface ShippingQuote {
  id: string; // UUID for DB storage
  provider: QuoteProviderCode; // Carrier code, or 'MERCHANT' for merchant rates
  serviceTier: string; // Budget, Express, Premium, etc.
  carrierName: string; // Actual carrier: DHL, FedEx, GIG Logistics
  displayName: string; // Customer-facing name: "Express Delivery"
  estimatedDays: number;
  deliveryRange?: string; // Human-readable range (e.g. "3-5 days")
  minDays?: number;
  maxDays?: number;
  price: number; // Naira (normalized, includes insurance)
  currency: 'NGN' | string;
  pickupIncluded: boolean;
  insuranceIncluded: boolean;
  providerRateId?: string; // For booking with provider
  expiresAt: Date;
  rawResponse?: unknown; // Raw provider response for debugging
  providerCost?: number;
  platformMargin?: number;
  marginBasisPoints?: number;
  pricingVersion?: string;

  // Station pickup (for areas without home delivery)
  isStationPickup?: boolean;
  stationId?: number;
  stationName?: string;
  stationAddress?: string;
  // Collection directions the shopper follows at the pickup point (merchant
  // rates surface `pickupAddress.instructions` here so the client can show them
  // before a pickup is chosen — the raw quote metadata is dropped downstream).
  stationInstructions?: string;
  stationCode?: string;
  // Legacy aliases
  pickupStationId?: number;
  pickupStationName?: string;
  pickupStationAddress?: string;
  pickupStationCode?: string;
}

export interface QuoteResponse {
  quotes: {
    featured: ShippingQuote[]; // Top 3: cheapest, fastest, recommended
    all: ShippingQuote[]; // All available quotes
  };
  sessionId: string;
  expiresAt: string;
  warnings?: string[]; // Any provider errors/warnings
}

// =============================================================================
// BOOKING TYPES
// =============================================================================

export interface BookingRequest {
  orderId: string;
  quoteId: string;
  merchantId?: string;
  providerRateId?: string; // Provider-specific rate ID for booking
  quoteMetadata?: unknown; // Stored provider quote metadata for booking
  sender: ShippingAddress;
  receiver: ShippingAddress;
  items: ShipmentItem[];
  pickupType?: 'pickup' | 'dropoff';
  instructions?: string;
  specialInstructions?: string;
}

export interface ShipmentBookingResult {
  provider: ShippingProviderCode;
  providerShipmentId: string;
  trackingNumber: string;
  carrierName: string;
  labelUrl?: string;
  estimatedDelivery?: Date;
  pickupScheduledAt?: Date;
  status: NormalizedShipmentStatus;
  isStationPickup?: boolean;
  pickupStationName?: string;
  pickupStationAddress?: string;
  rawResponse?: unknown;
}

// =============================================================================
// DATABASE TYPES (matching Supabase schema)
// =============================================================================

export type {
  ShipmentRecord,
  ShippingQuoteRecord,
} from './shipping-record-types';

// =============================================================================
// CANCELLATION TYPES
// =============================================================================

export interface CancellationResult {
  success: boolean;
  message: string;
  refundAmount?: number;
  refundCurrency?: string;
}

// =============================================================================
// SELF-FULFILLMENT TYPES
// =============================================================================

export interface SelfFulfillmentData {
  trackingNumber?: string | null;
  dispatchPhone?: string | null;
  carrierName?: string;
}

// =============================================================================
// LOCATION TYPES (for address lookup)
// =============================================================================

export type {
  NigerianCity,
  NigerianState,
  UnifiedLocation,
} from './shipping-location-types';
