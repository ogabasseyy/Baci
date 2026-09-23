/**
 * `confirm_repair_pickup_payment` raises when the repair already has a
 * different `pickup_payment_reference` (second valid Paystack capture).
 * SQLSTATE 23505 + message `repair_pickup_payment_conflict`.
 */
export function isRepairPickupPaymentConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; message?: unknown };
  const message = typeof record.message === 'string' ? record.message : '';
  if (!message.includes('repair_pickup_payment_conflict')) return false;
  // Prefer the SQLSTATE raised by the RPC; accept message-only when PostgREST
  // omits code so we still ACK after ledgering instead of infinite 503.
  return typeof record.code !== 'string' || record.code === '23505';
}
