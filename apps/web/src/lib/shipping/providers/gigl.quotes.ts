import { quoteProviderFailure } from '../quote-provider-failure';
import type { QuoteRequest, ShippingQuote } from '../types';
import type { GiglApiClient } from './gigl.auth';
import {
  GIGL_QUOTE_TIMEOUT_MS,
  type GiglQuoteIo,
  isGiglAbortError,
  PickupOptions,
} from './gigl.constants';
import { fetchGiglQuote } from './gigl.fetch-quote';
import { getGiglInternationalQuotes } from './gigl.international';
import {
  createGiglQuoteSelections,
  type GiglQuoteSelection,
  runGiglQuoteSelections,
} from './gigl.quote-selections';
import type { GiglStation } from './gigl.schemas';
import { createGiglStationQuoteExpander } from './gigl.station-quote-expander';
import type { GiglStationsService } from './gigl.stations';
export function getGiglQuotes(
  apiClient: GiglApiClient,
  stationsService: GiglStationsService,
  io: GiglQuoteIo,
  request: QuoteRequest
): Promise<ShippingQuote[]> {
  if (request.shipmentType === 'international') {
    return getGiglInternationalQuotes(apiClient, io, request);
  }
  return getQuotesWithinTimeout(
    apiClient,
    stationsService,
    io,
    request,
    AbortSignal.timeout(GIGL_QUOTE_TIMEOUT_MS)
  );
}
async function getQuotesWithinTimeout(
  apiClient: GiglApiClient,
  stationsService: GiglStationsService,
  io: GiglQuoteIo,
  request: QuoteRequest,
  signal: AbortSignal
): Promise<ShippingQuote[]> {
  try {
    const tokenData = await apiClient.getApiToken(
      GIGL_QUOTE_TIMEOUT_MS,
      signal
    );
    const senderStation = request.sender
      ? await stationsService.findStationForCity(
          request.sender.city,
          request.sender.state,
          GIGL_QUOTE_TIMEOUT_MS,
          signal
        )
      : null;
    if (!request.sender || !senderStation) {
      io.log('warn', 'No GIGL station found for sender location', {
        city: request.sender?.city,
        state: request.sender?.state,
      });
      return [];
    }
    const receiverResolution = await stationsService.resolveStationForLocation(
      request.receiver,
      {
        preferNearest: request.deliveryPreference === 'pickup_station',
        timeout: GIGL_QUOTE_TIMEOUT_MS,
        signal,
      }
    );
    const receiverStation = receiverResolution?.station ?? null;

    if (!receiverStation) {
      io.log('warn', 'No GIGL station found for receiver location', {
        city: request.receiver.city,
        state: request.receiver.state,
      });
      return [];
    }
    const totalWeight = request.items.reduce(
      (sum, item) => sum + item.weight * item.quantity,
      0
    );
    const isPickupOnly = request.deliveryPreference === 'pickup_station';
    const fetchSelections = (
      station: GiglStation,
      selections: GiglQuoteSelection[],
      selectionSignal = signal,
      isExpectedAbort?: () => boolean
    ) =>
      runGiglQuoteSelections({
        selections,
        signal: selectionSignal,
        timeoutMs: GIGL_QUOTE_TIMEOUT_MS,
        log: io.log,
        isExpectedAbort,
        fetchQuote: ({ deliveryType, pickupOption }) =>
          fetchGiglQuote(
            apiClient,
            io,
            tokenData,
            request,
            senderStation,
            station,
            pickupOption,
            deliveryType,
            totalWeight,
            selectionSignal
          ),
      });
    if (isPickupOnly) {
      const quoteResults = await fetchSelections(
        receiverStation,
        createGiglQuoteSelections(PickupOptions.ServiceCentre)
      );
      const expandStationQuote = createGiglStationQuoteExpander({
        directoryCentres: receiverResolution?.serviceCentres,
        fetchLiveCentres: () =>
          stationsService.getServiceCentres(
            receiverStation.StationId,
            GIGL_QUOTE_TIMEOUT_MS,
            signal
          ),
        generateQuoteId: io.generateQuoteId,
        log: io.log,
        receiver: request.receiver,
        receiverStation,
      });
      const stationQuotes = quoteResults.filter(
        (quote): quote is ShippingQuote => quote !== null
      );
      return (await Promise.all(stationQuotes.map(expandStationQuote))).flat();
    }
    const pickupController = new AbortController();
    const pickupSignal = AbortSignal.any([signal, pickupController.signal]);
    const homeQuotesPromise = fetchSelections(
      receiverStation,
      createGiglQuoteSelections(PickupOptions.HomeDelivery)
    );
    const prefetchedPickupQuotes = fetchSelections(
      receiverStation,
      createGiglQuoteSelections(PickupOptions.ServiceCentre),
      pickupSignal,
      () => pickupController.signal.aborted && !signal.aborted
    );
    void prefetchedPickupQuotes.catch(() => undefined);
    // A fully failed home batch must not abort the provider: record the
    // outage for aggregate diagnostics but keep trying station pickup, so a
    // partial home-delivery outage still yields pickup quotes.
    let batchFailure: unknown;
    let homeQuotes: ShippingQuote[] = [];
    try {
      homeQuotes = (await homeQuotesPromise).filter(
        (quote): quote is ShippingQuote => quote !== null
      );
    } catch (error) {
      batchFailure = error;
    }
    const hasRoadHome = homeQuotes.some(
      (quote) => quote.serviceTier === 'GoStandard'
    );
    if (hasRoadHome) {
      pickupController.abort();
      return homeQuotes;
    }
    let pickupResolution = receiverResolution;
    let pickupStation = receiverStation;
    let pickupQuotes: (ShippingQuote | null)[] = [];
    try {
      pickupQuotes = await prefetchedPickupQuotes;
    } catch (error) {
      batchFailure ??= error;
    }
    if (!receiverResolution?.serviceCentres?.length && !signal.aborted) {
      const nearestResolution = await stationsService.resolveStationForLocation(
        request.receiver,
        {
          preferNearest: true,
          timeout: GIGL_QUOTE_TIMEOUT_MS,
          signal,
        }
      );
      if (nearestResolution) {
        if (nearestResolution.station.StationId === receiverStation.StationId) {
          pickupResolution = nearestResolution;
        } else {
          // A failed nearest repricing must not discard the quoted
          // station's pickup quotes: fall back to expanding those.
          let nearestQuotes: (ShippingQuote | null)[] = [];
          try {
            nearestQuotes = await fetchSelections(
              nearestResolution.station,
              createGiglQuoteSelections(PickupOptions.ServiceCentre),
              signal
            );
          } catch {
            nearestQuotes = [];
          }
          if (nearestQuotes.some((quote) => quote !== null)) {
            pickupResolution = nearestResolution;
            pickupQuotes = nearestQuotes;
            pickupStation = nearestResolution.station;
          }
        }
      }
    }
    const stationPickupQuotes = pickupQuotes.filter(
      (quote): quote is ShippingQuote => quote !== null
    );
    const expandStationQuote = createGiglStationQuoteExpander({
      directoryCentres: pickupResolution?.serviceCentres,
      fetchLiveCentres: () =>
        stationsService.getServiceCentres(
          pickupStation.StationId,
          GIGL_QUOTE_TIMEOUT_MS,
          pickupSignal
        ),
      generateQuoteId: io.generateQuoteId,
      log: io.log,
      receiver: request.receiver,
      receiverStation: pickupStation,
    });
    const expandedStationQuotes = (
      await Promise.all(stationPickupQuotes.map(expandStationQuote))
    ).flat();
    const allQuotes = [...homeQuotes, ...expandedStationQuotes];
    if (allQuotes.length === 0) {
      // An aborted request that yields nothing is a timeout, not successful
      // no-coverage — mark it so the pickup fallback still engages.
      if (signal.aborted) {
        io.log('warn', 'GIGL quote selection timed out', {
          timeoutMs: GIGL_QUOTE_TIMEOUT_MS,
        });
        return quoteProviderFailure.mark(
          [],
          new Error('GIGL quote request timed out')
        );
      }
      if (batchFailure !== undefined) {
        throw batchFailure;
      }
    }
    return allQuotes;
  } catch (error) {
    if (signal.aborted || isGiglAbortError(error)) {
      io.log('warn', 'GIGL quote timed out', {
        timeoutMs: GIGL_QUOTE_TIMEOUT_MS,
      });
      return quoteProviderFailure.mark(
        [],
        new Error('GIGL quote request timed out')
      );
    }
    io.log('error', 'Failed to get GIGL quotes', { error: String(error) });
    return quoteProviderFailure.mark([], error);
  }
}
