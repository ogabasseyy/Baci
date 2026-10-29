import {
  giglAddressValidationDataSchema,
  type HomeDeliveryCoverage,
} from '@/schemas/gigl-address-validation';
import type { ShippingAddress } from '../types';
import type { GiglApiClient } from './gigl.auth';
import type { GiglLog, GiglToken } from './gigl.constants';

/** Reverse-geocoding coverage check; it cannot turn address text into a pin. */
export async function getGiglHomeDeliveryCoverage(
  apiClient: GiglApiClient,
  tokenData: GiglToken,
  receiver: ShippingAddress,
  signal: AbortSignal,
  log: GiglLog
): Promise<HomeDeliveryCoverage | undefined> {
  // New validation requests stay inactive until their provider cost is confirmed.
  // Disabled means unverified coverage; it does not claim the destination is served.
  if (process.env.GIGL_ADDRESS_VALIDATION_ENABLED !== 'true') return undefined;
  // Leave room within the quote deadline for station pricing on a failed check.
  const validationSignal = AbortSignal.any([signal, AbortSignal.timeout(1500)]);
  try {
    const { envelope, response } =
      await apiClient.safeFetchEnvelopeWithAccessToken(
        `${apiClient.baseUrl}/lga/validateAddress`,
        apiClient.currentToken ?? tokenData,
        () => ({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Latitude: receiver.latitude,
            Longitude: receiver.longitude,
          }),
          timeout: 1500,
          signal: validationSignal,
        }),
        { maxResponseBytes: 16 * 1024 }
      );
    if (!response.ok) await response.body?.cancel().catch(() => undefined);
    const parsed = giglAddressValidationDataSchema.safeParse(envelope?.data);
    if (
      response.ok &&
      envelope?.status === 200 &&
      envelope.success !== false &&
      parsed.success
    ) {
      return parsed.data.HomeDeliveryStatus ? 'supported' : 'unsupported';
    }
    // The docs use 401 for both Unauthorized and an unmatched LGA. Neither
    // authentication errors nor missing/malformed booleans prove no coverage.
    log('warn', 'GIGL home delivery coverage unavailable', {
      code: 'gigl_coverage_unavailable',
      status: envelope?.status ?? response.status,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    log('warn', 'GIGL home delivery coverage unavailable', {
      code: 'gigl_coverage_unavailable',
    });
  }
  return 'unavailable';
}
