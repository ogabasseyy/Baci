export type ObservationByteBucket =
  | 'under_16kib'
  | '16kib_to_64kib'
  | '64kib_to_256kib'
  | '256kib_to_1mib'
  | 'over_1mib';

export function classifyObservationBytes(bytes: number): ObservationByteBucket {
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new Error('Invalid observation measurement');
  if (bytes < 16 * 1024) return 'under_16kib';
  if (bytes < 64 * 1024) return '16kib_to_64kib';
  if (bytes < 256 * 1024) return '64kib_to_256kib';
  if (bytes <= 1024 * 1024) return '256kib_to_1mib';
  return 'over_1mib';
}
