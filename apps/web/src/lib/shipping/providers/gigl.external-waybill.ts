import { z } from 'zod';
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

async function parseGiglErrorMessage(
  response: Response,
  signal: AbortSignal
): Promise<string> {
  try {
    const payload = await readResponseJson(response, {
      maxResponseBytes: GIGL_ERROR_BODY_MAX_BYTES,
      signal,
    });
    const parsed = giglSchemas.envelopeObject.safeParse(payload);
    return parsed.success ? (parsed.data.message ?? '') : '';
  } catch {
    return '';
  }
}

/**
 * Reads GIG's error message without ever outliving the lookup deadline.
 * safeFetch stops watching the signal once headers arrive, and cancelling a
 * cloned stream can wait on its unread twin, so the read is raced against
 * the signal and abandoned (with a non-blocking cancel) when it fires.
 */
export function readGiglErrorMessage(
  response: Response,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve) => {
    const giveUp = () => {
      void response.body?.cancel().catch(() => undefined);
      resolve('');
    };
    if (signal.aborted) {
      giveUp();
      return;
    }
    signal.addEventListener('abort', giveUp, { once: true });
    void parseGiglErrorMessage(response, signal).then((message) => {
      signal.removeEventListener('abort', giveUp);
      resolve(message);
    });
  });
}

function tokenRejectedUnlessNotFound(
  signal: AbortSignal
): GiglTokenRejectionCheck {
  return async (response) => {
    if (response.status !== 401 && response.status !== 403) return false;
    const message = await readGiglErrorMessage(response.clone(), signal);
    return !GIGL_NOT_FOUND_MESSAGE.test(message);
  };
}

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
    tokenRejectedUnlessNotFound(signal)
  );

  if (!result.envelope) {
    const message = await readGiglErrorMessage(result.response, signal);
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
// GIG answers with one record or a list; accept both, as the pre-shipment
// ownership attestor does.
const giglPreShipmentRecords = z
  .union([giglSchemas.preShipmentData, giglSchemas.preShipmentData.element])
  .transform((data) => (Array.isArray(data) ? data : [data]));

/**
 * The record for the requested waybill. If GIG returns several records for it
 * that name different accounts, the account identifiers are dropped so the
 * ownership check fails closed instead of trusting whichever came first.
 */
export function pickPreShipment(
  records: GiglPreShipment[],
  waybill: string
): GiglPreShipment | undefined {
  const wanted = waybill.trim().toUpperCase();
  const matching = records.filter(
    (entry) => entry.Waybill.trim().toUpperCase() === wanted
  );
  const [first] = matching;
  if (!first) return undefined;
  const owner = (entry: GiglPreShipment) =>
    `${entry.CustomerCode?.trim().toUpperCase() ?? ''}|${entry.UserId?.trim().toLowerCase() ?? ''}`;
  if (matching.some((entry) => owner(entry) !== owner(first))) {
    return { ...first, CustomerCode: undefined, UserId: undefined };
  }
  return first;
}

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

    const preShipment = pickPreShipment(
      apiClient.parseEnvelopeData(
        preShipmentResult.envelope,
        giglPreShipmentRecords,
        'pre-shipment'
      ),
      waybill
    );
    if (!preShipment) {
      return { status: 'not_found' };
    }

    // Tracking only describes the parcel; the tracking monitor polls it
    // again after linking, so a failed or unreadable snapshot is not fatal.
    let tracking: TrackingResult | null = null;
    try {
      const trackingResult = await fetchGiglLookup(
        apiClient,
        preShipmentResult.tokenData,
        `${apiClient.baseUrl}/track/mobileShipment?Waybill=${encodedWaybill}&fetchOption=1`,
        signal
      );
      if (trackingResult.status === 'found') {
        const [shipment] = apiClient.parseEnvelopeData(
          trackingResult.envelope,
          giglSchemas.trackingData,
          'tracking'
        );
        tracking = shipment
          ? normalizeGiglTrackingShipment(shipment, waybill, new Date())
          : null;
      }
    } catch (error) {
      io.log('warn', 'GIGL external waybill tracking snapshot unavailable', {
        code: 'gigl_external_waybill_tracking_unavailable',
        message: error instanceof Error ? error.message : 'unknown',
      });
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
