import { z } from 'zod';

/** What the cancel endpoint reports about a cancel-only refund. */
export const CancellationRefundDetailsSchema = z.object({
  currency: z.string().trim().min(1),
  inFlightAmount: z.number().finite().nonnegative(),
  remainingAmount: z.number().finite().nonnegative(),
});

export type CancellationRefundDetails = z.infer<
  typeof CancellationRefundDetailsSchema
>;

/**
 * Reads `sideEffects.refund` / `refundDetails` from a cancel response.
 * Present-but-malformed details are never trusted: the outcome becomes
 * `unknown` and no amounts are returned, so clients show the neutral
 * "check the Refund card" message instead of a hand-refund amount.
 */
export function readCancellationSideEffects(sideEffects: unknown): {
  details?: CancellationRefundDetails;
  outcome?: string;
} {
  if (!sideEffects || typeof sideEffects !== 'object') return {};
  const record = sideEffects as Record<string, unknown>;
  const outcome =
    typeof record.refund === 'string' && record.refund
      ? record.refund
      : undefined;
  if (record.refundDetails === undefined || record.refundDetails === null) {
    return outcome ? { outcome } : {};
  }
  const parsed = CancellationRefundDetailsSchema.safeParse(
    record.refundDetails
  );
  if (!parsed.success) return { outcome: 'unknown' };
  return { ...(outcome && { outcome }), details: parsed.data };
}
