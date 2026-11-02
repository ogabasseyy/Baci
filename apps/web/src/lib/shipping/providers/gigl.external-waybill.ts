import type { TrackingResult } from '../types';
import type { GiglApiClient } from './gigl.auth';
import type { GiglTokenRejectionCheck } from './gigl.auth-request';
import {
  GIGL_TRACKING_RESPONSE_MAX_BYTES,
  type GiglApiEnvelope,
  type GiglProviderIo,
  type GiglToken,
  isGiglAbortError,
} from './gigl.constants';
import { readResponseJson } from './gigl.response-json';
import { type GiglPreShipment, giglSchemas } from './gigl.schemas';
import { normalizeGiglTrackingShipment } from './gigl.tracking-normalizer';

// Covers a cold `/login` (observed at ~8.5s) plus both read-only lookups.
export const GIGL_EXTERNAL_WAYBILL_LOOKUP_TIMEOUT_MS = 25_000;
const GIGL_ERROR_BODY_MAX_BYTES = 16 * 1_024;
// GIG answers unknown waybills with HTTP 401 and a "not found" message, which
// must not be mistaken for an expired access token.
const GIGL_NOT_FOUND_MESSAGE = /not\s+found/i;

export type GiglExternalWaybillLookup =
  | { status: 'not_found' }
  | {
      status: 'found';
      account: Pick<GiglToken, 'userChannelCode' | 'userId'>;
      preShipment: GiglPreShipment;
      tracking: TrackingResult | null;
    };

async function readGiglErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await readResponseJson(response, {
      maxResponseBytes: GIGL_ERROR_BODY_MAX_BYTES,
    });
    const parsed = giglSchemas.envelopeObject.safeParse(payload);
    return parsed.success ? (parsed.data.message ?? '') : '';
  } catch {
    return '';
  }
}

const isTokenRejectedUnlessNotFound: GiglTokenRejectionCheck = async (
  response
) => {
  if (response.status !== 401 && response.status !== 403) return false;
  const message = await readGiglErrorMessage(response.clone());
  return !GIGL_NOT_FOUND_MESSAGE.test(message);
};

function isNotFoundEnvelope(envelope: GiglApiEnvelope): boolean {
  return (
    envelope.status !== 200 &&
    GIGL_NOT_FOUND_MESSAGE.test(envelope.message ?? '')
  );
}

async function fetchGiglLookup(
  apiClient: GiglApiClient,
  tokenData: GiglToken,
  url: string,
  signal: AbortSignal
): Promise<
  | { status: 'not_found'; tokenData: GiglToken }
  | { status: 'found'; envelope: GiglApiEnvelope; tokenData: GiglToken }
> {
  const result = await apiClient.safeFetchEnvelopeWithAccessToken(
    url,
    tokenData,
    () => ({
      method: 'GET',
      timeout: GIGL_EXTERNAL_WAYBILL_LOOKUP_TIMEOUT_MS,
      signal,
    }),
    { maxResponseBytes: GIGL_TRACKING_RESPONSE_MAX_BYTES },
    isTokenRejectedUnlessNotFound
  );

  if (!result.envelope) {
    const message = await readGiglErrorMessage(result.response);
    if (
      result.response.status === 401 &&
      GIGL_NOT_FOUND_MESSAGE.test(message)
    ) {
      return { status: 'not_found', tokenData: result.tokenData };
    }
    throw new Error(`GIGL waybill lookup failed (${result.response.status})`);
  }

  if (isNotFoundEnvelope(result.envelope)) {
    return { status: 'not_found', tokenData: result.tokenData };
  }
  if (result.envelope.status !== 200) {
    throw new Error('Invalid GIGL waybill lookup response');
  }
  return {
    status: 'found',
    envelope: result.envelope,
    tokenData: result.tokenData,
  };
}

/**
 * Reads a waybill that may have been created outside Baci (for example in
 * GIG's own app) from GIG's read-only pre-shipment and tracking endpoints.
 * Nothing is booked or charged.
 */
export async function lookupGiglExternalWaybill(
  apiClient: GiglApiClient,
  io: GiglProviderIo,
  waybill: string
): Promise<GiglExternalWaybillLookup> {
  const signal = AbortSignal.timeout(GIGL_EXTERNAL_WAYBILL_LOOKUP_TIMEOUT_MS);
  const encodedWaybill = encodeURIComponent(waybill);

  try {
    const initialToken = await apiClient.getApiToken(
      GIGL_EXTERNAL_WAYBILL_LOOKUP_TIMEOUT_MS,
      signal
    );
    const preShipmentResult = await fetchGiglLookup(
      apiClient,
      initialToken,
      `${apiClient.baseUrl}/get/preshipment?Waybill=${encodedWaybill}`,
      signal
    );
    if (preShipmentResult.status === 'not_found') {
      return { status: 'not_found' };
    }

    const preShipment = apiClient
      .parseEnvelopeData(
        preShipmentResult.envelope,
        giglSchemas.preShipmentData,
        'pre-shipment'
      )
      .find((entry) => entry.Waybill.trim() === waybill);
    if (!preShipment) {
      return { status: 'not_found' };
    }

    const trackingResult = await fetchGiglLookup(
      apiClient,
      preShipmentResult.tokenData,
      `${apiClient.baseUrl}/track/mobileShipment?Waybill=${encodedWaybill}&fetchOption=1`,
      signal
    );
    let tracking: TrackingResult | null = null;
    if (trackingResult.status === 'found') {
      try {
        const [shipment] = apiClient.parseEnvelopeData(
          trackingResult.envelope,
          giglSchemas.trackingData,
          'tracking'
        );
        tracking = shipment
          ? normalizeGiglTrackingShipment(shipment, waybill, new Date())
          : null;
      } catch (error) {
        // Tracking only describes the parcel; the tracking monitor polls it
        // again after linking, so an unreadable snapshot is not fatal.
        io.log('warn', 'GIGL external waybill tracking snapshot unreadable', {
          code: 'gigl_external_waybill_tracking_unreadable',
          message: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    return {
      status: 'found',
      account: {
        userChannelCode: preShipmentResult.tokenData.userChannelCode,
        userId: preShipmentResult.tokenData.userId,
      },
      preShipment,
      tracking,
    };
  } catch (error) {
    if (signal.aborted || isGiglAbortError(error)) {
      io.log('warn', 'GIGL external waybill lookup timed out', {
        timeoutMs: GIGL_EXTERNAL_WAYBILL_LOOKUP_TIMEOUT_MS,
      });
      throw new Error('GIGL waybill lookup timed out');
    }
    throw error;
  }
}

/**
 * A waybill belongs to Baci's GIG account only when every identifier GIG
 * returned matches the logged-in account and at least one was comparable.
 */
export function isGiglWaybillOwnedByAccount(
  preShipment: Pick<GiglPreShipment, 'CustomerCode' | 'UserId'>,
  account: Pick<GiglToken, 'userChannelCode' | 'userId'>
): boolean {
  const comparisons: boolean[] = [];
  const customerCode = preShipment.CustomerCode?.trim();
  if (customerCode) {
    comparisons.push(
      customerCode.toUpperCase() ===
        account.userChannelCode.trim().toUpperCase()
    );
  }
  const userId = preShipment.UserId?.trim();
  const accountUserId = account.userId?.trim();
  if (userId && accountUserId) {
    comparisons.push(userId.toLowerCase() === accountUserId.toLowerCase());
  }
  return comparisons.length > 0 && comparisons.every(Boolean);
}
