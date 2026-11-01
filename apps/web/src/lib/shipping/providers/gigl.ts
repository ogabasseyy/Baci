/**
 * GIGL Shipping Provider
 */

import type {
  BookingRequest,
  CancellationResult,
  QuoteRequest,
  ShipmentBookingResult,
  ShippingQuote,
  TrackingResult,
  UnifiedLocation,
} from '../types';
import { BaseShippingProvider } from './base';
import { GiglApiClient } from './gigl.auth';
import { bookGiglShipment } from './gigl.booking';
import {
  GIGL_QUOTE_TIMEOUT_MS,
  type GiglFetchOptions,
  type GiglToken,
} from './gigl.constants';
import { findNearestGiglServiceCentres } from './gigl.directory';
import { getGiglQuotes } from './gigl.quotes';
import { GiglStationsService } from './gigl.stations';
import { trackGiglShipment } from './gigl.tracking';
import { trackGiglShipmentBatch } from './gigl.tracking-batch';

export class GiglProvider extends BaseShippingProvider {
  readonly code = 'GIGL' as const;
  readonly name = 'GIGL';
  readonly displayName = 'GIG Logistics';
  readonly supportsInternational = true;
  readonly supportsDomestic = true;

  private readonly apiClient: GiglApiClient;
  private readonly stationsService: GiglStationsService;

  constructor(initialToken: GiglToken | null = null) {
    super();
    this.apiClient = new GiglApiClient(
      {
        safeFetch: (url: string, options?: GiglFetchOptions) =>
          this.safeFetch(url, options),
        log: (level, message, data) => this.log(level, message, data),
      },
      initialToken
    );
    this.stationsService = new GiglStationsService(
      this.apiClient,
      findNearestGiglServiceCentres
    );
  }

  get currentToken(): GiglToken | null {
    return this.apiClient.currentToken;
  }

  getLocations(countryCode = 'NG'): Promise<UnifiedLocation[]> {
    return this.stationsService.getLocations(countryCode);
  }

  getStations(timeout?: number, signal?: AbortSignal) {
    return this.stationsService.getStations(timeout, signal);
  }

  getQuotes(request: QuoteRequest): Promise<ShippingQuote[]> {
    return getGiglQuotes(
      this.apiClient,
      this.stationsService,
      this.quoteIo,
      request
    );
  }

  bookShipment(request: BookingRequest): Promise<ShipmentBookingResult> {
    return bookGiglShipment(
      this.apiClient,
      this.stationsService,
      this.providerIo,
      request
    );
  }

  trackShipment(trackingNumber: string): Promise<TrackingResult> {
    return trackGiglShipment(this.apiClient, this.providerIo, trackingNumber);
  }

  trackShipments(
    trackingNumbers: readonly string[]
  ): Promise<Map<string, TrackingResult>> {
    return trackGiglShipmentBatch(
      this.apiClient,
      this.providerIo,
      trackingNumbers
    );
  }

  cancelShipment(shipmentId: string): Promise<CancellationResult> {
    this.log('warn', 'GIGL cancellation not implemented', { shipmentId });

    return Promise.resolve({
      success: false,
      message:
        'GIGL shipment cancellation must be done through their customer service',
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.apiClient.getApiToken(GIGL_QUOTE_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  private get providerIo() {
    return {
      safeFetch: (url: string, options?: GiglFetchOptions) =>
        this.safeFetch(url, options),
      log: (
        level: 'info' | 'warn' | 'error',
        message: string,
        data?: Record<string, unknown>
      ) => this.log(level, message, data),
    };
  }

  private get quoteIo() {
    return {
      ...this.providerIo,
      generateQuoteId: () => this.generateQuoteId(),
      getQuoteExpiry: (hours?: number) => this.getQuoteExpiry(hours),
    };
  }
}

export const giglProvider = new GiglProvider();
