import { createHash } from 'node:crypto';
import {
  type BuildOrderIdempotencyPayloadOptions,
  buildOrderIdempotencyPayload,
  type OrderIdempotencyPayloadInput,
} from '@baci/shared';

export {
  type BuildOrderIdempotencyPayloadOptions,
  buildOrderIdempotencyPayload,
  type OrderIdempotencyPayloadInput,
};

export function hashOrderIdempotencyPayload(
  payload: ReturnType<typeof buildOrderIdempotencyPayload>
) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
