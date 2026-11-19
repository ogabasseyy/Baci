import type { GiglApiClient } from './gigl.auth';
import {
  GIGL_PRESHIPMENT_MAX_RECORDS,
  GIGL_PRESHIPMENT_RESPONSE_MAX_BYTES,
  GIGL_TRACKING_TIMEOUT_MS,
  GIGL_TRACKING_WAYBILL_MAX_LENGTH,
  type GiglProviderIo,
  isGiglAbortError,
} from './gigl.constants';

// GIG's /track/mobileShipment feed never shows a cancellation made in the GIG
// app; only GET /get/preshipment exposes it as IsCancelled. 'unknown' means
// GIG gave no usable answer, so callers must leave the shipment untouched.
export type GiglWaybillCancellation = 'cancelled' | 'active' | 'unknown';

export async function readGiglWaybillCancellation(
  apiClient: GiglApiClient,
  io: GiglProviderIo,
  waybill: string
): Promise<GiglWaybillCancellation> {
  const wanted = waybill.trim();
  if (!wanted || wanted.length > GIGL_TRACKING_WAYBILL_MAX_LENGTH) {
    return 'unknown';
  }
  const signal = AbortSignal.timeout(GIGL_TRACKING_TIMEOUT_MS);
  try {
    const tokenData = await apiClient.getApiToken(
      GIGL_TRACKING_TIMEOUT_MS,
      signal
    );
    const { envelope, response } =
      await apiClient.safeFetchEnvelopeWithAccessToken(
        `${apiClient.baseUrl}/get/preshipment?Waybill=${encodeURIComponent(wanted)}`,
        tokenData,
        () => ({ method: 'GET', signal, timeout: GIGL_TRACKING_TIMEOUT_MS }),
        { maxResponseBytes: GIGL_PRESHIPMENT_RESPONSE_MAX_BYTES }
      );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      io.log('warn', 'GIGL preshipment cancellation check failed', {
        code: 'gigl_preshipment_cancellation_http_error',
        status: response.status,
      });
      return 'unknown';
    }
    if (
      !envelope ||
      envelope.success === false ||
      envelope.status < 200 ||
      envelope.status >= 300
    ) {
      io.log('warn', 'GIGL preshipment cancellation check failed', {
        code: 'gigl_preshipment_cancellation_invalid_envelope',
        status: envelope?.status ?? null,
      });
      return 'unknown';
    }
    const data = envelope.data;
    const records = Array.isArray(data) ? data : data ? [data] : [];
    if (records.length > GIGL_PRESHIPMENT_MAX_RECORDS) return 'unknown';

    let matched = false;
    for (const entry of records) {
      if (entry === null || typeof entry !== 'object') continue;
      const waybillValue = 'Waybill' in entry ? entry.Waybill : undefined;
      if (String(waybillValue ?? '').trim() !== wanted) continue;
      matched = true;
      // Same rule as the external-waybill preview: cancelled or deleted.
      if (
        ('IsCancelled' in entry && entry.IsCancelled === true) ||
        ('IsDeleted' in entry && entry.IsDeleted === true)
      ) {
        return 'cancelled';
      }
    }
    return matched ? 'active' : 'unknown';
  } catch (error) {
    io.log('warn', 'GIGL preshipment cancellation check failed', {
      code:
        signal.aborted || isGiglAbortError(error)
          ? 'gigl_preshipment_cancellation_timeout'
          : 'gigl_preshipment_cancellation_error',
    });
    return 'unknown';
  }
}
