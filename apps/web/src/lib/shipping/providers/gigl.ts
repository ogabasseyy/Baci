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
import { GIGL_QUOTE_TIMEOUT_MS, type GiglFetchOptions } from './gigl.constants';
import { findNearestGiglServiceCentres } from './gigl.directory';
import {
  type GiglExternalWaybillLookup,
  lookupGiglExternalWaybill,
} from './gigl.external-waybill';
import {
  type GiglWaybillCancellation,
  readGiglWaybillCancellation,
} from './gigl.preshipment-cancellation';
import {
  attestGiglWaybillOwnership,
  type GiglWaybillOwnership,
} from './gigl.preshipment-ownership';
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

  private readonly apiClient = new GiglApiClient({
    safeFetch: (url: string, options?: GiglFetchOptions) =>
      this.safeFetch(url, options),
    log: (level, message, data) => this.log(level, message, data),
  });
  private readonly stationsService = new GiglStationsService(
    this.apiClient,
    findNearestGiglServiceCentres
  );

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

  /** Read-only lookup of a waybill that may have been booked outside Baci. */
  lookupExternalWaybill(waybill: string): Promise<GiglExternalWaybillLookup> {
    return lookupGiglExternalWaybill(this.apiClient, this.providerIo, waybill);
  }

  /** Whether GIG says Baci's own GIG account holds this waybill. */
  attestWaybillOwnership(
    trackingNumber: string
  ): Promise<GiglWaybillOwnership> {
    return attestGiglWaybillOwnership(
      this.apiClient,
      this.providerIo,
      trackingNumber
    );
  }

  /** Whether GIG's preshipment record says the waybill was cancelled. */
  readWaybillCancellation(
    trackingNumber: string
  ): Promise<GiglWaybillCancellation> {
    return readGiglWaybillCancellation(
      this.apiClient,
      this.providerIo,
      trackingNumber
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
