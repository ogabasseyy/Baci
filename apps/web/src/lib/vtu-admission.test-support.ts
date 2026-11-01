/** Shared RPC fixture for the authenticated admission transport. */
export function admissionProofResponse(
  {
    admissionTimestamp,
    admissionLive = [],
    admissionError = null,
  }: {
    admissionTimestamp?: string | null;
    admissionLive?: string[];
    admissionError?: { message: string } | null;
  },
  fallback: string
) {
  const stamp =
    admissionTimestamp === undefined ? fallback : admissionTimestamp;
  return Promise.resolve({
    data:
      stamp === null
        ? null
        : [{ admitted_at: stamp, live_transaction_ids: admissionLive }],
    error: admissionError,
  });
}
