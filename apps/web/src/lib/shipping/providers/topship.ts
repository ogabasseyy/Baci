/**
 * Topship Shipping Provider
 * Aggregator that provides access to multiple carriers (DHL, FedEx, etc.)
 */

import { quoteProviderFailure } from '../quote-provider-failure';
import { mapTopshipStatus } from '../status-mapper';
import type {
  BookingRequest,
  CancellationResult,
  QuoteRequest,
  ShipmentBookingResult,
  ShippingQuote,
  TrackingEvent,
  TrackingResult,
  UnifiedLocation,
} from '../types';
import { ShippingBookingRejectedError } from '../types';
import { BaseShippingProvider } from './base';

// =============================================================================
// CONFIGURATION
// =============================================================================

const TOPSHIP_API_KEY = process.env.TOPSHIP_API_KEY;
const TOPSHIP_BASE_URL =
  process.env.TOPSHIP_USE_SANDBOX === 'true'
    ? process.env.TOPSHIP_SANDBOX_URL || 'https://topship-staging.africa/api'
    : process.env.TOPSHIP_BASE_URL || 'https://api-topship.com/api';

// =============================================================================
// TOPSHIP-SPECIFIC TYPES
// =============================================================================

interface TopshipQuoteItem {
  category: string;
  description: string;
  weight: number;
  quantity: number;
  value: number;
}

interface TopshipRate {
  serviceType: string;
  pricingTier: string;
  cost: number; // In KOBO (divide by 100 for Naira)
  vat?: number; // In KOBO
  total?: number; // In KOBO
  currency: string;
  estimatedDeliveryDate?: string;
  deliveryEta?: string;
  carrierName?: string;
  carrierLogo?: string;
  actualCost?: number | null;
  remoteAreaCost?: number | null;
  budgetDeliveryCost?: number | null;
  budgetCategory?: string | null;
  tags?: string[];
}

interface TopshipSavedShipment {
  id: string;
  trackingId: string;
  shipmentStatus: string;
  status?: string;
  pricingTier?: string;
  itemCollectionMode?: string;
  isPaid?: boolean;
  pickupCharge?: number;
  shipmentCharge?: number;
  valueAddedTaxCharge?: number;
  totalCharge?: number;
  label?: string;
  estimatedDeliveryDate?: string;
  [key: string]: unknown;
}

interface TopshipWrappedShipmentResponse {
  status: boolean;
  message: string;
  data: TopshipSavedShipment & {
    shipmentId?: string;
  };
}

interface TopshipTrackingResponse {
  status: boolean;
  message: string;
  data: {
    trackingId: string;
    status: string;
    events: Array<{
      status: string;
      description: string;
      location?: string;
      timestamp: string;
    }>;
    estimatedDeliveryDate?: string;
    deliveredAt?: string;
  };
}

interface TopshipState {
  id: number;
  name: string;
  code: string;
  countryCode: string;
}

interface TopshipCity {
  id: number;
  name: string;
  stateId: number;
  stateName: string;
}

// Category mapping for Topship
const TOPSHIP_CATEGORIES: Record<string, string> = {
  electronics: 'Gadgets',
  fashion: 'Fashion',
  appliances: 'Appliance',
  documents: 'Document',
  food: 'Food',
  default: 'Others',
};

const TOPSHIP_DEFAULT_PICKUP_CHARGE_KOBO = 200000;
const TOPSHIP_VAT_RATE = 0.075;
const TOPSHIP_WEIGHT_BUCKETS_KG = [1, 2, 5, 10, 20, 50] as const;

function normalizeTopshipQuoteLocation(value: string | undefined): string {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue.toLowerCase() : 'unknown';
}

function getTopshipQuoteWeightBucket(totalWeight: number): string {
  const normalizedWeight = Number.isFinite(totalWeight)
    ? Math.max(0, totalWeight)
    : 0;
  const bucket = TOPSHIP_WEIGHT_BUCKETS_KG.find(
    (maxWeight) => normalizedWeight <= maxWeight
  );

  return bucket ? `lte_${bucket}kg` : 'gt_50kg';
}

function getTopshipQuoteItemCategories(request: QuoteRequest): string[] {
  return [
    ...new Set(
      request.items
        .map((item) => item.category?.trim().toLowerCase())
        .filter((category): category is string => Boolean(category))
    ),
  ].slice(0, 5);
}

function getTopshipQuoteDiagnostics(
  request: QuoteRequest,
  totalWeight: number,
  result?: unknown
): Record<string, unknown> {
  const responseRecord =
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>)
      : null;

  return {
    senderCity: normalizeTopshipQuoteLocation(request.sender?.city),
    senderCountryCode: request.sender?.countryCode || 'NG',
    receiverCity: normalizeTopshipQuoteLocation(request.receiver.city),
    receiverState: normalizeTopshipQuoteLocation(request.receiver.state),
    receiverCountryCode: request.receiver.countryCode || 'NG',
    weightBucket: getTopshipQuoteWeightBucket(totalWeight),
    itemCategories: getTopshipQuoteItemCategories(request),
    responseStatus: responseRecord?.status,
  };
}

// =============================================================================
// TOPSHIP PROVIDER IMPLEMENTATION
// =============================================================================

export class TopshipProvider extends BaseShippingProvider {
  readonly code = 'TOPSHIP' as const;
  readonly name = 'Topship';
  readonly displayName = 'Topship'; // Hidden from customers
  readonly supportsInternational = true;
  readonly supportsDomestic = true;

  // Location cache
  private statesCache: TopshipState[] | null = null;
  private citiesCache: Map<string, TopshipCity[]> = new Map();
  private locationsCacheExpiry = 0;
  private readonly LOCATIONS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  // Rate cache
  private rateCache: Map<string, { rates: TopshipRate[]; expiry: number }> =
    new Map();
  private readonly RATE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private generateRateCacheKey(request: QuoteRequest): string {
    return JSON.stringify({
      sCity: request.sender?.city,
      sCountry: request.sender?.countryCode,
      rCity: request.receiver.city,
      rCountry: request.receiver.countryCode,
      weight: request.items.reduce(
        (sum, item) => sum + item.weight * item.quantity,
        0
      ),
    });
  }

  // ==========================================================================
  // LOCATIONS API
  // ==========================================================================

  async getLocations(countryCode: string = 'NG'): Promise<UnifiedLocation[]> {
    const states = await this.getStates(countryCode);
    const locations: UnifiedLocation[] = [];

    for (const state of states) {
      const cities = await this.getCities(state.code);
      for (const city of cities) {
        locations.push({
          state: state.name,
          city: city.name,
        });
      }
    }

    return locations;
  }

  async getStates(countryCode: string = 'NG'): Promise<TopshipState[]> {
    // Check cache
    if (this.statesCache && Date.now() < this.locationsCacheExpiry) {
      return this.statesCache.filter((s) => s.countryCode === countryCode);
    }

    const response = await this.safeFetch(
      `${TOPSHIP_BASE_URL}/get-states?countryCode=${countryCode}`,
      {
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      this.log('warn', 'Failed to fetch Topship states', {
        status: response.status,
      });
      return [];
    }

    const result = await response.json();

    // Handle both array response and wrapped response formats
    let states: TopshipState[] = [];
    if (Array.isArray(result)) {
      // Direct array response from Topship API
      states = result.map(
        (s: { name: string; code: string; countryCode: string }) => ({
          id: 0,
          name: s.name,
          code: s.code,
          countryCode: s.countryCode,
        })
      );
    } else if (result.status && result.data) {
      // Wrapped response format
      states = result.data;
    }

    if (states.length > 0) {
      this.statesCache = states;
      this.locationsCacheExpiry = Date.now() + this.LOCATIONS_CACHE_TTL;
    }

    return states;
  }

  async getCities(stateCode: string): Promise<TopshipCity[]> {
    // Check cache
    if (this.citiesCache.has(stateCode)) {
      return this.citiesCache.get(stateCode) ?? [];
    }

    // Topship API requires countryCode for cities
    const response = await this.safeFetch(
      `${TOPSHIP_BASE_URL}/get-cities?stateCode=${stateCode}&countryCode=NG`,
      {
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      this.log('warn', 'Failed to fetch Topship cities', {
        stateCode,
        status: response.status,
      });
      return [];
    }

    const result = await response.json();

    // Handle both array response and wrapped response formats
    let cities: TopshipCity[] = [];
    if (Array.isArray(result)) {
      // Direct array response - map to our format
      cities = result.map(
        (
          c: { name?: string; cityName?: string; stateCode?: string },
          idx: number
        ) => ({
          id: idx,
          name: c.name || c.cityName || '',
          stateId: 0,
          stateName: stateCode,
        })
      );
    } else if (result.status && result.data) {
      // Wrapped response format
      cities = result.data;
    }

    if (cities.length > 0) {
      this.citiesCache.set(stateCode, cities);
    }

    return cities;
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private getHeaders(): Record<string, string> {
    if (!TOPSHIP_API_KEY) {
      throw new Error('Topship API key not configured');
    }

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOPSHIP_API_KEY}`,
    };
  }

  private mapCategory(category?: string): string {
    if (!category) return TOPSHIP_CATEGORIES.default;
    const lower = category.toLowerCase();
    return TOPSHIP_CATEGORIES[lower] || TOPSHIP_CATEGORIES.default;
  }

  private koboToNaira(kobo: number): number {
    return Math.round(kobo / 100);
  }

  private parseDeliveryEta(eta?: string): {
    estimatedDays: number;
    minDays?: number;
    maxDays?: number;
  } {
    if (!eta) {
      return { estimatedDays: 5 };
    }

    // Parse formats like "3-5 days", "2 days", "within 48 hours"
    const rangeMatch = eta.match(/(\d+)\s*-\s*(\d+)/);
    if (rangeMatch) {
      const min = Number.parseInt(rangeMatch[1], 10);
      const max = Number.parseInt(rangeMatch[2], 10);
      return {
        estimatedDays: Math.round((min + max) / 2),
        minDays: min,
        maxDays: max,
      };
    }

    const singleMatch = eta.match(/(\d+)/);
    if (singleMatch) {
      const days = Number.parseInt(singleMatch[1], 10);
      return { estimatedDays: days };
    }

    return { estimatedDays: 5 };
  }

  private getCarrierDisplayName(
    pricingTier: string,
    carrierName?: string
  ): string {
    // Map Topship pricing tiers to actual carrier names
    const tier = pricingTier.toLowerCase();

    if (carrierName) {
      return carrierName;
    }

    if (tier.includes('fedex')) return 'FedEx';
    if (tier.includes('dhl')) return 'DHL';
    if (tier.includes('ups')) return 'UPS';
    if (tier.includes('aramex')) return 'Aramex';
    if (tier.includes('gig')) return 'GIG Logistics';

    // For generic tiers, use the tier name
    if (tier === 'budget') return 'Budget Shipping';
    if (tier === 'express') return 'Express Shipping';
    if (tier === 'premium') return 'Premium Shipping';

    return pricingTier;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private parseQuoteMetadata(value: unknown): Partial<TopshipRate> {
    if (!this.isRecord(value)) {
      return {};
    }

    return {
      serviceType:
        this.readString(value.serviceType) || this.readString(value.mode),
      pricingTier: this.readString(value.pricingTier),
      cost: this.readNumber(value.cost),
      vat: this.readNumber(value.vat),
      total: this.readNumber(value.total),
      currency: this.readString(value.currency),
      estimatedDeliveryDate: this.readString(value.estimatedDeliveryDate),
      deliveryEta:
        this.readString(value.deliveryEta) || this.readString(value.duration),
      carrierName: this.readString(value.carrierName),
      carrierLogo: this.readString(value.carrierLogo),
      actualCost: this.readNumber(value.actualCost) ?? null,
      remoteAreaCost: this.readNumber(value.remoteAreaCost) ?? null,
      budgetDeliveryCost: this.readNumber(value.budgetDeliveryCost) ?? null,
      budgetCategory: this.readString(value.budgetCategory) ?? null,
      tags: Array.isArray(value.tags)
        ? value.tags.filter((tag): tag is string => typeof tag === 'string')
        : undefined,
    };
  }

  private parseProviderRateId(providerRateId?: string): {
    pricingTier?: string;
    serviceType?: string;
  } {
    if (!providerRateId) {
      return {};
    }

    const separatorIndex = providerRateId.indexOf('_');
    if (separatorIndex === -1) {
      return {
        pricingTier: providerRateId,
      };
    }

    return {
      pricingTier: providerRateId.slice(0, separatorIndex),
      serviceType: providerRateId.slice(separatorIndex + 1) || undefined,
    };
  }

  private resolveShipmentRoute(
    request: BookingRequest
  ): 'Domestic' | 'International' {
    return request.sender.countryCode === request.receiver.countryCode
      ? 'Domestic'
      : 'International';
  }

  private resolveItemCollectionMode(
    pickupType?: BookingRequest['pickupType']
  ): 'PickUp' | 'DropOff' {
    return pickupType === 'dropoff' ? 'DropOff' : 'PickUp';
  }

  private calculateVatCharge(
    shipmentCharge: number,
    pickupCharge: number
  ): number {
    return Math.round((shipmentCharge + pickupCharge) * TOPSHIP_VAT_RATE);
  }

  private buildShipmentAddressDetail(address: BookingRequest['sender']) {
    return {
      name: address.name,
      email: address.email,
      phoneNumber: address.phone,
      addressLine1: address.address,
      city: address.city,
      state: address.state,
      country: address.country,
      countryCode: address.countryCode,
      postalCode: address.postalCode,
    };
  }

  private buildSaveShipmentPayload(
    request: BookingRequest,
    options: {
      pricingTier: string;
      shipmentCharge: number;
      pickupCharge: number;
      valueAddedTaxCharge: number;
      shipmentRoute: 'Domestic' | 'International';
      itemCollectionMode: 'PickUp' | 'DropOff';
    }
  ) {
    const items: TopshipQuoteItem[] = request.items.map((item) => ({
      category: this.mapCategory(item.category),
      description: item.description || item.name,
      weight: item.weight,
      quantity: item.quantity,
      value: item.value,
    }));

    return {
      shipment: [
        {
          shipmentRoute: options.shipmentRoute,
          itemCollectionMode: options.itemCollectionMode,
          pricingTier: options.pricingTier,
          insuranceType: 'None',
          shipmentCharge: options.shipmentCharge,
          valueAddedTaxCharge: options.valueAddedTaxCharge,
          pickupCharge: options.pickupCharge,
          senderDetail: this.buildShipmentAddressDetail(request.sender),
          receiverDetail: this.buildShipmentAddressDetail(request.receiver),
          items,
        },
      ],
    };
  }

  private async readResponseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private getErrorMessage(payload: unknown): string | undefined {
    if (typeof payload === 'string' && payload.length > 0) {
      return payload;
    }

    if (!this.isRecord(payload)) {
      return undefined;
    }

    return this.readString(payload.message) || this.readString(payload.error);
  }

  private parseExpectedPickupCharge(payload: unknown): number | undefined {
    const message = this.getErrorMessage(payload);
    if (!message) {
      return undefined;
    }

    const match = message.match(/Expecting NGN\s*([0-9,]+(?:\.\d+)?)/i);
    if (!match) {
      return undefined;
    }

    const amount = Number.parseFloat(match[1].replace(/,/g, ''));
    return Number.isFinite(amount) ? Math.round(amount * 100) : undefined;
  }

  private parseSavedShipment(payload: unknown): TopshipSavedShipment {
    if (
      Array.isArray(payload) &&
      payload.length > 0 &&
      this.isRecord(payload[0])
    ) {
      return payload[0] as TopshipSavedShipment;
    }

    if (
      this.isRecord(payload) &&
      this.readString(payload.id) &&
      this.readString(payload.trackingId)
    ) {
      return payload as TopshipSavedShipment;
    }

    if (
      this.isRecord(payload) &&
      payload.status === true &&
      this.isRecord(payload.data)
    ) {
      const data = payload.data as TopshipWrappedShipmentResponse['data'];
      return {
        ...data,
        id: data.id || data.shipmentId || '',
      };
    }

    throw new Error('Failed to create Topship shipment');
  }

  private async saveShipmentWithRetry(
    request: BookingRequest,
    options: {
      pricingTier: string;
      shipmentCharge: number;
      shipmentRoute: 'Domestic' | 'International';
      itemCollectionMode: 'PickUp' | 'DropOff';
      pickupCharge: number;
    }
  ): Promise<TopshipSavedShipment> {
    let pickupCharge = options.pickupCharge;

    for (let attempt = 0; attempt < 2; attempt++) {
      const valueAddedTaxCharge = this.calculateVatCharge(
        options.shipmentCharge,
        pickupCharge
      );
      const payload = this.buildSaveShipmentPayload(request, {
        ...options,
        pickupCharge,
        valueAddedTaxCharge,
      });

      const response = await this.safeFetch(
        `${TOPSHIP_BASE_URL}/save-shipment`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(payload),
        }
      );
      const result = await this.readResponseBody(response);

      if (response.ok) {
        return this.parseSavedShipment(result);
      }

      const expectedPickupCharge = this.parseExpectedPickupCharge(result);
      if (
        attempt === 0 &&
        expectedPickupCharge !== undefined &&
        expectedPickupCharge !== pickupCharge
      ) {
        pickupCharge = expectedPickupCharge;
        continue;
      }

      this.log('error', 'Topship save shipment failed', {
        status: response.status,
        error: this.getErrorMessage(result) || String(result),
      });
      throw new Error(
        this.getErrorMessage(result) || 'Failed to create Topship shipment'
      );
    }

    throw new Error('Failed to create Topship shipment');
  }

  // ==========================================================================
  // GET QUOTES
  // ==========================================================================

  async getQuotes(request: QuoteRequest): Promise<ShippingQuote[]> {
    try {
      // Calculate total weight
      const totalWeight = request.items.reduce(
        (sum, item) => sum + item.weight * item.quantity,
        0
      );

      // Check cache
      const cacheKey = this.generateRateCacheKey(request);
      const cached = this.rateCache.get(cacheKey);
      if (cached && Date.now() < cached.expiry) {
        // Return cached rates mapped to ShippingQuote
        return this.mapRatesToQuotes(cached.rates);
      }

      // Topship API requires GET with shipmentDetail query parameter
      const shipmentDetail = {
        senderDetails: {
          cityName: request.sender?.city || 'Lagos',
          countryCode: request.sender?.countryCode || 'NG',
        },
        receiverDetails: {
          cityName: request.receiver.city,
          countryCode: request.receiver.countryCode || 'NG',
        },
        totalWeight: totalWeight || 1,
      };

      const queryParam = encodeURIComponent(JSON.stringify(shipmentDetail));

      const response = await this.safeFetch(
        `${TOPSHIP_BASE_URL}/get-shipment-rate?shipmentDetail=${queryParam}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
          timeout: 8000, // 8 seconds timeout (fail fast)
        }
      );

      if (!response.ok) {
        const error = await response.text();
        this.log('error', 'Topship quote request failed', {
          status: response.status,
          error,
        });
        throw new Error(`Topship quote request failed (${response.status})`);
      }

      const result = await response.json();

      // Handle both array response and wrapped response
      let rates: TopshipRate[] = [];
      if (Array.isArray(result)) {
        rates = result.map(
          (r: {
            mode?: string;
            cost?: number;
            duration?: string;
            currency?: string;
            pricingTier?: string;
          }) => ({
            serviceType: r.mode || 'Standard',
            pricingTier: r.pricingTier || 'Budget',
            cost: r.cost || 0,
            vat: 0,
            total: r.cost || 0,
            currency: r.currency || 'NGN',
            deliveryEta: r.duration,
          })
        );
      } else if (result.status && result.data) {
        rates = result.data;
      }

      if (rates.length === 0) {
        this.log(
          'warn',
          'No Topship quotes returned',
          getTopshipQuoteDiagnostics(request, totalWeight, result)
        );
        return [];
      }

      // Cache the raw rates
      this.rateCache.set(cacheKey, {
        rates,
        expiry: Date.now() + this.RATE_CACHE_TTL,
      });

      return this.mapRatesToQuotes(rates);
    } catch (error) {
      this.log('error', 'Failed to get Topship quotes', {
        error: String(error),
      });
      return quoteProviderFailure.mark([], error);
    }
  }

  private mapRatesToQuotes(rates: TopshipRate[]): ShippingQuote[] {
    return rates.map((rate) => {
      const deliveryEta = this.parseDeliveryEta(rate.deliveryEta);
      const carrierName = this.getCarrierDisplayName(
        rate.pricingTier,
        rate.carrierName
      );

      return {
        id: this.generateQuoteId(),
        provider: 'TOPSHIP' as const,
        serviceTier: rate.pricingTier,
        carrierName,
        displayName: `${carrierName} - ${rate.serviceType}`,
        estimatedDays: deliveryEta.estimatedDays,
        deliveryRange: rate.deliveryEta, // Pass raw string
        minDays: deliveryEta.minDays,
        maxDays: deliveryEta.maxDays,
        price: this.koboToNaira(rate.total ?? rate.cost),
        currency: 'NGN',
        pickupIncluded: true,
        insuranceIncluded: true,
        providerRateId: `${rate.pricingTier}_${rate.serviceType}`,
        expiresAt: this.getQuoteExpiry(1),
        rawResponse: rate,
      };
    });
  }

  // ==========================================================================
  // BOOK SHIPMENT
  // ==========================================================================

  async bookShipment(request: BookingRequest): Promise<ShipmentBookingResult> {
    const quoteMetadata = this.parseQuoteMetadata(request.quoteMetadata);
    const rateFromId = this.parseProviderRateId(request.providerRateId);
    const pricingTier =
      quoteMetadata.pricingTier || rateFromId.pricingTier || 'Premium';
    const serviceType = quoteMetadata.serviceType || rateFromId.serviceType;
    const shipmentCharge = quoteMetadata.cost;

    if (shipmentCharge === undefined) {
      throw new Error(
        'Topship booking requires stored quote metadata with a shipment charge.'
      );
    }

    const itemCollectionMode = this.resolveItemCollectionMode(
      request.pickupType
    );
    const shipmentRoute = this.resolveShipmentRoute(request);
    const initialPickupCharge =
      itemCollectionMode === 'PickUp' ? TOPSHIP_DEFAULT_PICKUP_CHARGE_KOBO : 0;

    const savedShipment = await this.saveShipmentWithRetry(request, {
      pricingTier,
      shipmentCharge,
      shipmentRoute,
      itemCollectionMode,
      pickupCharge: initialPickupCharge,
    });

    const payResponse = await this.safeFetch(
      `${TOPSHIP_BASE_URL}/pay-from-wallet`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          detail: {
            shipmentId: savedShipment.id,
          },
        }),
      }
    );
    const payResult = await this.readResponseBody(payResponse);

    if (!payResponse.ok) {
      const message =
        this.getErrorMessage(payResult) ||
        'Failed to confirm Topship shipment payment';
      this.log('error', 'Topship payment failed', {
        status: payResponse.status,
        error: message,
        trackingId: savedShipment.trackingId,
      });
      throw new ShippingBookingRejectedError(
        `Failed to confirm Topship shipment payment for tracking ${savedShipment.trackingId}: ${message}`
      );
    }

    const paidShipment = this.parseSavedShipment(payResult);

    return {
      provider: 'TOPSHIP',
      providerShipmentId: paidShipment.id,
      trackingNumber: paidShipment.trackingId,
      carrierName: serviceType
        ? `${this.getCarrierDisplayName(pricingTier)} - ${serviceType}`
        : this.getCarrierDisplayName(pricingTier),
      status: mapTopshipStatus(
        paidShipment.shipmentStatus || paidShipment.status || 'booked'
      ),
      rawResponse: paidShipment,
    };
  }

  // ==========================================================================
  // TRACK SHIPMENT
  // ==========================================================================

  async trackShipment(trackingNumber: string): Promise<TrackingResult> {
    const response = await this.safeFetch(
      `${TOPSHIP_BASE_URL}/track-shipment?trackingId=${encodeURIComponent(trackingNumber)}`,
      {
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      this.log('error', 'Topship tracking failed', { status: response.status });
      throw new Error('Failed to track Topship shipment');
    }

    const result: TopshipTrackingResponse = await response.json();

    if (!result.status || !result.data) {
      throw new Error('Shipment not found');
    }

    const events: TrackingEvent[] = (result.data.events || []).map((event) => ({
      status: event.status,
      description: event.description,
      location: event.location,
      timestamp: new Date(event.timestamp),
      rawStatus: event.status,
    }));

    const status = mapTopshipStatus(result.data.status);

    return {
      provider: 'TOPSHIP',
      trackingNumber,
      status,
      carrierName: 'Topship',
      estimatedDelivery: result.data.estimatedDeliveryDate
        ? new Date(result.data.estimatedDeliveryDate)
        : undefined,
      actualDelivery: result.data.deliveredAt
        ? new Date(result.data.deliveredAt)
        : undefined,
      events: events.sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
      ),
    };
  }

  // ==========================================================================
  // CANCEL SHIPMENT
  // ==========================================================================

  async cancelShipment(shipmentId: string): Promise<CancellationResult> {
    const response = await this.safeFetch(
      `${TOPSHIP_BASE_URL}/cancel-shipment`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ shipmentId }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      this.log('error', 'Topship cancellation failed', {
        status: response.status,
        error,
      });
      return {
        success: false,
        message: 'Failed to cancel shipment',
      };
    }

    const result = await response.json();

    return {
      success: result.status === true,
      message:
        result.message ||
        (result.status ? 'Shipment cancelled' : 'Cancellation failed'),
      refundAmount: result.data?.refundAmount
        ? this.koboToNaira(result.data.refundAmount)
        : undefined,
    };
  }

  // ==========================================================================
  // HEALTH CHECK
  // ==========================================================================

  async isAvailable(): Promise<boolean> {
    try {
      // Try to fetch states as a health check
      const states = await this.getStates('NG');
      return states.length > 0;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const topshipProvider = new TopshipProvider();
