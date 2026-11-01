import {
  accountIdentitySchema,
  type ChowdeckAccountIdentityV1,
  type ChowdeckCoreReadObservationV1,
  coreObservationSchema,
} from './schemas/core-read-observation';

export type ObservationLatencyBucket =
  | 'under_250ms'
  | '250ms_to_1s'
  | '1s_to_2s'
  | '2s_to_5s'
  | '5s_to_10s'
  | 'over_10s';

export type ObservationByteBucket =
  | 'under_16kib'
  | '16kib_to_64kib'
  | '64kib_to_256kib'
  | '256kib_to_1mib'
  | 'over_1mib';

type BlockedObservationInput = Pick<
  ChowdeckCoreReadObservationV1,
  'capturedAt' | 'manifestDigest' | 'publicContractDigest'
>;

function invalidIdentity(): never {
  throw new Error('Invalid account identity');
}

function invalidObservation(): never {
  throw new Error('Invalid core observation');
}

export function parseAccountIdentity(
  input: unknown
): ChowdeckAccountIdentityV1 {
  try {
    return accountIdentitySchema.parse(input);
  } catch {
    return invalidIdentity();
  }
}

export function classifyObservationLatency(
  milliseconds: number
): ObservationLatencyBucket {
  if (!Number.isFinite(milliseconds) || milliseconds < 0)
    throw new Error('Invalid observation measurement');
  if (milliseconds < 250) return 'under_250ms';
  if (milliseconds < 1_000) return '250ms_to_1s';
  if (milliseconds < 2_000) return '1s_to_2s';
  if (milliseconds < 5_000) return '2s_to_5s';
  // Include the request timeout in the final finite bucket.
  if (milliseconds <= 10_000) return '5s_to_10s';
  return 'over_10s';
}

export function classifyObservationBytes(bytes: number): ObservationByteBucket {
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new Error('Invalid observation measurement');
  if (bytes < 16 * 1024) return 'under_16kib';
  if (bytes < 64 * 1024) return '16kib_to_64kib';
  if (bytes < 256 * 1024) return '64kib_to_256kib';
  if (bytes <= 1024 * 1024) return '256kib_to_1mib';
  return 'over_1mib';
}

export function createBlockedCoreObservation(
  input: BlockedObservationInput
): ChowdeckCoreReadObservationV1 {
  return parseCoreObservation({
    contractVersion: 1,
    capturedAt: input.capturedAt,
    publicContractDigest: input.publicContractDigest,
    manifestDigest: input.manifestDigest,
    status: 'not_observed',
    blockerCode: 'provider_response_schema_unproven',
    capabilities: {
      accountRead: 'unproven',
      categoryRead: 'unproven',
      menuRead: 'unproven',
      itemRead: 'unproven',
    },
    latencyBucket: 'unavailable',
    byteBucket: 'unavailable',
    rateLimitBucket: 'unavailable',
    limitBucket: 'unavailable',
  });
}

export function parseCoreObservation(
  input: unknown
): ChowdeckCoreReadObservationV1 {
  try {
    return coreObservationSchema.parse(input);
  } catch {
    return invalidObservation();
  }
}

export type { ChowdeckAccountIdentityV1, ChowdeckCoreReadObservationV1 };
