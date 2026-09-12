import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import {
  type ShippingProvider,
  ShippingProviderRegistry,
} from './providers/base';
import { GiglProvider } from './providers/gigl';
import {
  GIGL_BASE_URL,
  GIGL_EMAIL,
  GIGL_ENABLED,
  GIGL_PASSWORD,
  isExplicitlyDisabledEnv,
  isGiglRuntimeConfigured,
} from './providers/gigl.constants';
import { TopshipProvider } from './providers/topship';
import { QuoteAggregator } from './quote-aggregator';
import type {
  BookingRequest,
  CancellationResult,
  QuoteRequest,
  QuoteResponse,
  ShipmentBookingResult,
  ShippingProviderCode,
  ShippingQuote,
  TrackingResult,
  UnifiedLocation,
} from './types';

const registry = new ShippingProviderRegistry();
const trackingRegistry = new ShippingProviderRegistry();
const operationsRegistry = new ShippingProviderRegistry();

function isTopshipEnabledForNewShipments(): boolean {
  return !isExplicitlyDisabledEnv(process.env.TOPSHIP_ENABLED);
}

function registerProvider(
  provider: ShippingProvider,
  { enabledForNewShipments }: { enabledForNewShipments: boolean }
) {
  if (enabledForNewShipments) {
    registry.register(provider);
  }
  trackingRegistry.register(provider);
  operationsRegistry.register(provider);
}

// Register providers
if (isGiglRuntimeConfigured()) {
  registerProvider(new GiglProvider(), { enabledForNewShipments: true });
}

registerProvider(new TopshipProvider(), {
  enabledForNewShipments: isTopshipEnabledForNewShipments(),
});

// One-line startup fingerprint: which providers can quote, and — when GIGL is
// out — which of its config inputs is missing (presence booleans only, never
// values). An empty registry silently serves zero quotes to every checkout,
// so make the cause readable from runtime logs.
console.info('[Shipping] Provider registry initialized', {
  quoteProviders: registry.getAll().map((provider) => provider.code),
  giglRuntimeConfigured: isGiglRuntimeConfigured(),
  giglConfigPresence: {
    enabled: GIGL_ENABLED,
    baseUrl: Boolean(GIGL_BASE_URL),
    email: Boolean(GIGL_EMAIL),
    password: Boolean(GIGL_PASSWORD),
  },
  topshipEnabledForNewShipments: isTopshipEnabledForNewShipments(),
});

// Create aggregator
const aggregator = new QuoteAggregator(registry);

export class ShippingService {
  private registry: ShippingProviderRegistry;
  private trackingRegistry: ShippingProviderRegistry;
  private operationsRegistry: ShippingProviderRegistry;
  private aggregator: QuoteAggregator;

  constructor() {
    this.registry = registry;
    this.trackingRegistry = trackingRegistry;
    this.operationsRegistry = operationsRegistry;
    this.aggregator = aggregator;
  }

  private getProviderForNewShipment(provider: ShippingProviderCode) {
    const providerInstance = this.registry.get(provider);
    if (providerInstance) {
      return providerInstance;
    }

    if (this.trackingRegistry.get(provider)) {
      throw new OrderShipmentBookingError(
        `Provider ${provider} is disabled for new shipments`,
        400,
        'SHIPPING_PROVIDER_DISABLED'
      );
    }

    throw new Error(`Provider ${provider} not found`);
  }

  /**
   * Get aggregated shipping quotes from all enabled providers
   */
  async getQuotes(
    request: QuoteRequest,
    allowedProviderCodes?: readonly ShippingProviderCode[]
  ): Promise<QuoteResponse> {
    return await this.aggregator.getQuotes(request, allowedProviderCodes);
  }

  /**
   * Get quotes from a specific provider
   */
  async getProviderQuotes(
    provider: ShippingProviderCode,
    request: QuoteRequest
  ): Promise<ShippingQuote[]> {
    const providerInstance = this.getProviderForNewShipment(provider);
    return await providerInstance.getQuotes(request);
  }

  /**
   * Book a shipment with the specified provider
   */
  async bookShipment(
    provider: ShippingProviderCode,
    request: BookingRequest
  ): Promise<ShipmentBookingResult> {
    const providerInstance = this.getProviderForNewShipment(provider);

    console.log('[ShippingService] Booking shipment', {
      provider,
      orderId: request.orderId,
      quoteId: request.quoteId,
    });

    const result = await providerInstance.bookShipment(request);

    console.log('[ShippingService] Shipment booked successfully', {
      provider,
      trackingNumber: result.trackingNumber,
    });

    return result;
  }

  /**
   * Track a shipment by tracking number
   * Tries all providers if provider is not specified
   */
  async trackShipment(
    trackingNumber: string,
    provider?: ShippingProviderCode
  ): Promise<TrackingResult> {
    // If provider is specified, use it directly
    if (provider) {
      const providerInstance = this.trackingRegistry.get(provider);
      if (!providerInstance) {
        throw new Error(`Provider ${provider} not found`);
      }
      return providerInstance.trackShipment(trackingNumber);
    }

    // Try all providers
    const providers = this.trackingRegistry.getAll();
    const errors: string[] = [];

    for (const p of providers) {
      try {
        const result = await p.trackShipment(trackingNumber);
        return result;
      } catch (error) {
        errors.push(
          `${p.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    throw new Error(
      `Shipment not found. Tried providers: ${errors.join(', ')}`
    );
  }

  /**
   * Cancel a shipment
   */
  async cancelShipment(
    provider: ShippingProviderCode,
    shipmentId: string
  ): Promise<CancellationResult> {
    const providerInstance = this.operationsRegistry.get(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    console.log('[ShippingService] Cancelling shipment', {
      provider,
      shipmentId,
    });

    return await providerInstance.cancelShipment(shipmentId);
  }

  /**
   * Get Nigerian locations from all providers
   */
  async getNigerianLocations(): Promise<UnifiedLocation[]> {
    const allLocations: UnifiedLocation[] = [];
    const seenCities = new Set<string>();

    for (const provider of this.registry.getDomestic()) {
      if (provider.getLocations) {
        try {
          const locations = await provider.getLocations('NG');
          for (const loc of locations) {
            const key = `${loc.state}-${loc.city}`.toLowerCase();
            if (!seenCities.has(key)) {
              seenCities.add(key);
              allLocations.push(loc);
            }
          }
        } catch (error) {
          console.error(
            '[ShippingService] Failed to get locations from provider:',
            provider.name,
            error
          );
        }
      }
    }

    return allLocations;
  }

  // ==========================================================================
  // HEALTH CHECK
  // ==========================================================================

  /**
   * Check which providers are available
   */
  async getProviderStatus(): Promise<Record<ShippingProviderCode, boolean>> {
    const status: Record<string, boolean> = {};

    for (const provider of this.registry.getAll()) {
      try {
        status[provider.code] = await provider.isAvailable();
      } catch {
        status[provider.code] = false;
      }
    }

    return status as Record<ShippingProviderCode, boolean>;
  }

  /**
   * Get list of enabled providers
   */
  getEnabledProviders(): ShippingProviderCode[] {
    return this.registry.getAll().map((p) => p.code);
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const shippingService = new ShippingService();

// =============================================================================
// RE-EXPORTS
// =============================================================================

export * from './aggregator';
export {
  type ShippingProvider,
  ShippingProviderRegistry,
} from './providers/base';
export { QuoteAggregator } from './quote-aggregator';
export * from './status-mapper';
export * from './types';
