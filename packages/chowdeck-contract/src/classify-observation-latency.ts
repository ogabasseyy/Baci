export type ObservationLatencyBucket =
  | 'under_250ms'
  | '250ms_to_1s'
  | '1s_to_2s'
  | '2s_to_5s'
  | '5s_to_10s'
  | 'over_10s';

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
