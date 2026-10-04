import {
  type BuildOrderIdempotencyPayloadOptions,
  buildOrderIdempotencyPayload,
  type OrderIdempotencyPayloadInput,
} from './order-idempotency';

/**
 * Rebuild the canonical payload used before delivery metadata became part of
 * the server hash. This is used only when the database confirms that a retry
 * targets an order created before the metadata rollout.
 */
export function buildLegacyOrderIdempotencyPayload(
  input: OrderIdempotencyPayloadInput,
  options?: BuildOrderIdempotencyPayloadOptions
) {
  const legacyInput = { ...input };
  delete legacyInput.delivery_method;
  delete legacyInput.airport_type;
  return buildOrderIdempotencyPayload(legacyInput, options);
}
