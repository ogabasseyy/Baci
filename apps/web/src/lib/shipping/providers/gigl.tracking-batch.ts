import { z } from 'zod';
import type { TrackingResult } from '../types';
import type { GiglApiClient } from './gigl.auth';
import {
  GIGL_TRACKING_BATCH_LIMIT,
  GIGL_TRACKING_BATCH_TIMEOUT_MS,
  GIGL_TRACKING_MAX_EVENTS_PER_BATCH,
  GIGL_TRACKING_MAX_EVENTS_PER_SHIPMENT,
  GIGL_TRACKING_RESPONSE_MAX_BYTES,
  GIGL_TRACKING_WAYBILL_MAX_LENGTH,
  type GiglProviderIo,
  isGiglAbortError,
} from './gigl.constants';
import { giglSchemas } from './gigl.schemas';
import { normalizeGiglTrackingShipment } from './gigl.tracking-normalizer';

const observedBatchTrackingShipment = z
  .object({
    Amount: z.number(),
    Waybill: z.string().trim().min(1).max(GIGL_TRACKING_WAYBILL_MAX_LENGTH),
    WaybillLabel: z.string().trim().min(1),
    MobileShipmentTrackings: z
      .array(giglSchemas.trackingEvent)
      .max(GIGL_TRACKING_MAX_EVENTS_PER_SHIPMENT),
  })
  .loose();

const observedBatchTrackingData = z.array(z.unknown());

function parseObservedBatchTrackingEnvelope(
  envelope: {
    status: number;
    success?: boolean;
    data?: unknown;
  } | null
) {
  if (
    !envelope ||
    envelope.success === false ||
    envelope.status < 200 ||
    envelope.status >= 300
  ) {
    throw new Error('Invalid GIGL batch tracking response');
  }

  const parsed = observedBatchTrackingData.safeParse(envelope.data);
  if (!parsed.success) {
    throw new Error('Invalid GIGL batch tracking response');
  }

  const validShipments = parsed.data.flatMap((entry) => {
    const parsedShipment = observedBatchTrackingShipment.safeParse(entry);
    return parsedShipment.success ? [parsedShipment.data] : [];
  });

  const eventCount = validShipments.reduce(
    (total, shipment) => total + shipment.MobileShipmentTrackings.length,
    0
  );
  if (eventCount > GIGL_TRACKING_MAX_EVENTS_PER_BATCH) {
    throw new Error('GIGL batch tracking exceeds event limit');
  }

  return {
    invalidCount: parsed.data.length - validShipments.length,
    shipments: validShipments,
  };
}

export type GiglBatchTrackingOutcomes = {
  results: Map<string, TrackingResult>;
  failures: Map<string, Error>;
};

export async function trackGiglShipmentBatch(
  apiClient: GiglApiClient,
  io: GiglProviderIo,
  waybills: readonly string[]
): Promise<Map<string, TrackingResult>> {
  const { results } = await trackGiglShipmentBatchOutcomes(
    apiClient,
    io,
    waybills
  );
  return results;
}

/**
 * Tracks a batch of GIGL waybills and returns both normalized tracking results
 * and per-waybill parsing/normalization failures so callers can distinguish
 * malformed entries from waybills simply omitted by GIGL.
 */
export async function trackGiglShipmentBatchOutcomes(
  apiClient: GiglApiClient,
  io: GiglProviderIo,
  waybills: readonly string[]
): Promise<GiglBatchTrackingOutcomes> {
  const normalizedWaybills = waybills.map((waybill) => waybill.trim());
  if (normalizedWaybills.some((waybill) => !waybill)) {
    throw new Error('At least one GIGL waybill is required');
  }
  if (
    normalizedWaybills.some(
      (waybill) => waybill.length > GIGL_TRACKING_WAYBILL_MAX_LENGTH
    )
  ) {
    throw new Error('GIGL tracking waybill exceeds maximum length');
  }
  if (new Set(normalizedWaybills).size !== normalizedWaybills.length) {
    throw new Error('GIGL tracking batch contains duplicate waybill');
  }
  if (normalizedWaybills.length === 0) {
    throw new Error('At least one GIGL waybill is required');
  }
  if (normalizedWaybills.length > GIGL_TRACKING_BATCH_LIMIT) {
    throw new Error('GIGL tracking batch exceeds 50 waybills');
  }

  const signal = AbortSignal.timeout(GIGL_TRACKING_BATCH_TIMEOUT_MS);

  try {
    const tokenData = await apiClient.getApiToken(
      GIGL_TRACKING_BATCH_TIMEOUT_MS,
      signal
    );
    const { envelope, response } =
      await apiClient.safeFetchEnvelopeWithAccessToken(
        `${apiClient.baseUrl}/track/multipleMobileShipment`,
        tokenData,
        () => ({
          method: 'POST',
          body: JSON.stringify({ Waybill: normalizedWaybills }),
          headers: { 'Content-Type': 'application/json' },
          signal,
          timeout: GIGL_TRACKING_BATCH_TIMEOUT_MS,
        }),
        { maxResponseBytes: GIGL_TRACKING_RESPONSE_MAX_BYTES }
      );

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      io.log('error', 'GIGL batch tracking failed', {
        status: response.status,
      });
      throw new Error('Failed to track GIGL shipments');
    }

    const { invalidCount, shipments: trackingData } =
      parseObservedBatchTrackingEnvelope(envelope);
    if (invalidCount > 0) {
      io.log('warn', 'GIGL batch tracking omitted schema-invalid shipment', {
        count: invalidCount,
      });
    }
    const observedAt = new Date();
    const seenWaybills = new Set<string>();
    const requestedWaybills = new Set(normalizedWaybills);
    const failures = new Map<string, Error>();

    for (const shipment of trackingData) {
      const waybill = shipment.Waybill?.trim();
      if (!waybill) {
        continue;
      }
      if (!requestedWaybills.has(waybill)) {
        throw new Error('GIGL batch tracking returned an unrequested waybill');
      }
      if (seenWaybills.has(waybill)) {
        throw new Error('GIGL batch tracking returned duplicate waybill');
      }
      seenWaybills.add(waybill);
    }

    if (invalidCount > 0) {
      collectSchemaInvalidWaybillFailures(
        envelope,
        requestedWaybills,
        seenWaybills,
        failures
      );
    }

    const results = new Map(
      trackingData.flatMap((shipment) => {
        const waybill = shipment.Waybill?.trim();
        if (!waybill) return [];

        try {
          return [
            [
              waybill,
              normalizeGiglTrackingShipment(shipment, waybill, observedAt),
            ] as const,
          ];
        } catch (error) {
          failures.set(
            waybill,
            error instanceof Error
              ? error
              : new Error('GIGL batch tracking omitted malformed shipment')
          );
          io.log('warn', 'GIGL batch tracking omitted malformed shipment', {
            error: error instanceof Error ? error.message : 'unknown_error',
            waybill,
          });
          return [];
        }
      })
    );
    return { results, failures };
  } catch (error) {
    if (signal.aborted || isGiglAbortError(error)) {
      io.log('warn', 'GIGL batch tracking timed out', {
        timeoutMs: GIGL_TRACKING_BATCH_TIMEOUT_MS,
      });
      throw new Error('GIGL batch tracking timed out');
    }

    throw error;
  }
}

function collectSchemaInvalidWaybillFailures(
  envelope: unknown,
  requestedWaybills: ReadonlySet<string>,
  seenWaybills: ReadonlySet<string>,
  failures: Map<string, Error>
): void {
  const data =
    envelope && typeof envelope === 'object' && 'data' in envelope
      ? (envelope as { data?: unknown }).data
      : undefined;
  if (!Array.isArray(data)) return;

  for (const entry of data) {
    if (!entry || typeof entry !== 'object' || !('Waybill' in entry)) {
      continue;
    }
    const rawWaybill = (entry as { Waybill?: unknown }).Waybill;
    if (typeof rawWaybill !== 'string') continue;
    const waybill = rawWaybill.trim();
    if (
      !waybill ||
      !requestedWaybills.has(waybill) ||
      seenWaybills.has(waybill) ||
      failures.has(waybill)
    ) {
      continue;
    }
    failures.set(
      waybill,
      new Error('GIGL batch tracking returned schema-invalid shipment')
    );
  }
}
