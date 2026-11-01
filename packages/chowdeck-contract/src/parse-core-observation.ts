import {
  type ChowdeckCoreReadObservationV1,
  coreObservationSchema,
} from './schemas/core-read-observation';

function invalidObservation(): never {
  throw new Error('Invalid core observation');
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
