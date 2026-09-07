import { priceGiglQuote } from '../gigl-platform-pricing';
import type { QuoteRequest, ShippingQuote } from '../types';
import type { GiglApiClient } from './gigl.auth';
import {
  GIGL_QUOTE_TIMEOUT_MS,
  type GiglQuoteIo,
  isGiglAbortError,
  PickupOptions,
} from './gigl.constants';
import {
  buildInternationalItems,
  buildInternationalPackages,
  estimatedDays,
  internationalRateId,
  internationalServiceTier,
  isNigeriaAddress,
  resolveDestinationCountryId,
  totalDeclaredValue,
} from './gigl.international-payload';
import { giglSchemas } from './gigl.schemas';

export async function getGiglInternationalQuotes(
  apiClient: GiglApiClient,
  io: GiglQuoteIo,
  request: QuoteRequest
): Promise<ShippingQuote[]> {
  if (
    request.shipmentType !== 'international' ||
    !request.sender ||
    !isNigeriaAddress(request.sender) ||
    isNigeriaAddress(request.receiver)
  ) {
    return [];
  }

  const signal = AbortSignal.timeout(GIGL_QUOTE_TIMEOUT_MS);

  try {
    const tokenData = await apiClient.getApiToken(
      GIGL_QUOTE_TIMEOUT_MS,
      signal
    );
    const declaredValue = totalDeclaredValue(request);
    const pickupOption = PickupOptions.ServiceCentre;
    const destinationCountry = await resolveDestinationCountryId(
      apiClient,
      tokenData,
      request,
      GIGL_QUOTE_TIMEOUT_MS,
      signal
    );
    if (destinationCountry.status === 'lookup_failed') {
      io.log('warn', 'GIGL international destination country lookup failed', {
        envelopeStatus: destinationCountry.envelopeStatus,
        responseStatus: destinationCountry.responseStatus,
      });
      return [];
    }
    if (destinationCountry.status === 'not_found') {
      io.log('warn', 'GIGL international destination country not found', {
        country: request.receiver.country,
        countryCode: request.receiver.countryCode,
      });
      return [];
    }
    const shipmentPackages = buildInternationalPackages(request.items);
    const { envelope, response } =
      await apiClient.safeFetchEnvelopeWithAccessToken(
        `${apiClient.baseUrl}/intlShipment/price`,
        tokenData,
        () => ({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            DestinationCountryId: destinationCountry.countryId,
            ReceiverCity: request.receiver.city,
            ReceiverAddress: request.receiver.address,
            ReceiverPostalCode: request.receiver.postalCode,
            ReceiverCountryCode: request.receiver.countryCode,
            ReceiverCountry: request.receiver.country,
            ReceiverStateOrProvinceCode: request.receiver.state,
            PickupOptions: pickupOption,
            DeclaredValue: declaredValue,
            IsVacuumSeal: false,
            IsPhytosanitaryCertification: false,
            ShipmentItems: buildInternationalItems(request.items),
            ...(shipmentPackages.length > 0
              ? { ShipmentPackages: shipmentPackages }
              : {}),
          }),
          timeout: GIGL_QUOTE_TIMEOUT_MS,
          signal,
        })
      );

    if (!response.ok || envelope?.status !== 200) {
      io.log('warn', 'GIGL international quote failed', {
        status: response.status,
        envelopeStatus: envelope?.status,
      });
      return [];
    }

    const rates = parseInternationalRates(envelope.data, io);

    return rates.flatMap((rate) => {
      if (!hasInternationalBookingSelectors(rate)) {
        io.log('warn', 'Skipping GIGL international rate without selectors', {
          deliveryType: rate.DeliveryType,
          grandTotal: rate.GrandTotal,
          logisticCompany: rate.LogisticCompany,
          shipmentMethod: rate.ShipmentMethod,
        });
        return [];
      }

      const deliveryType = rate.DeliveryType;
      const logisticsCompany = rate.LogisticCompany;
      const shipmentMethod = rate.ShipmentMethod;
      const serviceTier = internationalServiceTier(deliveryType);
      const pricing = priceGiglQuote(rate.GrandTotal);
      return [
        {
          id: io.generateQuoteId(),
          provider: 'GIGL',
          serviceTier,
          carrierName: 'GIG Logistics',
          displayName: `GIG Logistics - ${serviceTier}`,
          estimatedDays: estimatedDays(rate.EstimatedDeliveryDateAndTime),
          price: pricing.price,
          providerCost: pricing.providerCost,
          platformMargin: pricing.platformMargin,
          marginBasisPoints: pricing.marginBasisPoints,
          pricingVersion: pricing.pricingVersion,
          currency: 'NGN',
          pickupIncluded: true,
          insuranceIncluded: true,
          providerRateId: internationalRateId({
            deliveryType,
            logisticsCompany,
            shipmentMethod,
            pickupOption,
          }),
          isStationPickup: false,
          expiresAt: io.getQuoteExpiry(1),
          rawResponse: rate,
        },
      ];
    });
  } catch (error) {
    if (signal.aborted || isGiglAbortError(error)) {
      io.log('warn', 'GIGL international quote timed out', {
        timeoutMs: GIGL_QUOTE_TIMEOUT_MS,
      });
      return [];
    }

    io.log('error', 'Failed to get GIGL international quotes', {
      error: String(error),
    });
    return [];
  }
}

function hasInternationalBookingSelectors(rate: {
  DeliveryType?: number;
  LogisticCompany?: number;
  ShipmentMethod?: number;
}): rate is {
  DeliveryType: number;
  LogisticCompany: number;
  ShipmentMethod: number;
} {
  return (
    isRateSelector(rate.DeliveryType) &&
    isRateSelector(rate.LogisticCompany) &&
    isRateSelector(rate.ShipmentMethod)
  );
}

function isRateSelector(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseInternationalRates(
  data: unknown,
  io: GiglQuoteIo
): ReturnType<typeof giglSchemas.internationalPriceRate.parse>[] {
  if (!Array.isArray(data)) {
    io.log('warn', 'Invalid GIGL international price response', {
      reason: 'data is not an array',
    });
    return [];
  }

  return data.flatMap((rate, index) => {
    const parsed = giglSchemas.internationalPriceRate.safeParse(rate);
    if (!parsed.success) {
      io.log('warn', 'Skipping invalid GIGL international rate', {
        index,
        issues: parsed.error.issues,
      });
      return [];
    }
    return [parsed.data];
  });
}
