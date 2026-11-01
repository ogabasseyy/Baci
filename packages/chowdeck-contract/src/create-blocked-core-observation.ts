import { parseCoreObservation } from './parse-core-observation';
import type { ChowdeckCoreReadObservationV1 } from './schemas/core-read-observation';

type BlockedObservationInput = Pick<
  ChowdeckCoreReadObservationV1,
  'capturedAt' | 'manifestDigest' | 'publicContractDigest'
>;

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
