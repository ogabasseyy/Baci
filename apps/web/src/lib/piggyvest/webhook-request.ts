import 'server-only';
import { piggyvestWebhookIntakeConfigurationSchema } from '@/schemas/piggyvest-webhook-intake';
import type {
  PiggyvestWebhookInbox,
  PiggyvestWebhookIntakeOutcome,
} from './webhook-inbox.types';
import { acceptPiggyvestStagingWebhook } from './webhook-intake';
import { PIGGYVEST_WEBHOOK_LIMITS } from './webhook-limits';

export type BoundedWebhookBodyResult =
  | { body: Buffer; ok: true }
  | { ok: false; reason: 'too_large' | 'unavailable' | 'invalid' };

/**
 * Shared bounded webhook body reader (64 KiB / 5 s): a request without a
 * declared Content-Length must never make the function buffer an unbounded
 * body before signature validation. Both the staging intake and the main
 * webhook route read through this helper.
 */
export async function readBoundedWebhookBody(
  request: Pick<Request, 'body' | 'headers' | 'signal'>
): Promise<BoundedWebhookBodyResult> {
  if (!request.body) return { body: Buffer.alloc(0), ok: true };
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && !/^\d+$/.test(declaredLength)) {
    return { ok: false, reason: 'invalid' };
  }
  if (Number(declaredLength) > PIGGYVEST_WEBHOOK_LIMITS.maxPayloadBytes) {
    return { ok: false, reason: 'too_large' };
  }
  if (request.signal.aborted) return { ok: false, reason: 'unavailable' };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  let rejectRead: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectRead = () => reject(new Error('Webhook body read unavailable'));
  });
  const onAbort = () => rejectRead?.();
  request.signal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(onAbort, PIGGYVEST_WEBHOOK_LIMITS.readTimeoutMs);
  const rawPayload = new Uint8Array(PIGGYVEST_WEBHOOK_LIMITS.maxPayloadBytes);
  let chunksRead = 0;
  let length = 0;
  let complete = false;

  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), interrupted]);
      if (chunk.done) {
        complete = true;
        break;
      }
      chunksRead += 1;
      if (chunksRead > PIGGYVEST_WEBHOOK_LIMITS.maxPayloadBytes) {
        return { ok: false, reason: 'invalid' };
      }
      length += chunk.value.byteLength;
      if (length > PIGGYVEST_WEBHOOK_LIMITS.maxPayloadBytes) {
        return { ok: false, reason: 'too_large' };
      }
      rawPayload.set(chunk.value, length - chunk.value.byteLength);
    }
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', onAbort);
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  return { body: Buffer.from(rawPayload.subarray(0, length)), ok: true };
}

export async function acceptPiggyvestStagingRequest({
  configuration,
  request,
  inbox,
}: {
  configuration: unknown;
  request: Pick<Request, 'body' | 'headers' | 'signal'>;
  inbox: PiggyvestWebhookInbox;
}): Promise<PiggyvestWebhookIntakeOutcome> {
  if (
    !piggyvestWebhookIntakeConfigurationSchema.safeParse(configuration).success
  ) {
    return 'not_ready';
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
      contentType
    ) ||
    request.headers.has('content-encoding') ||
    !request.body
  ) {
    return 'invalid_payload';
  }
  const bounded = await readBoundedWebhookBody(request);
  if (!bounded.ok) {
    if (bounded.reason === 'too_large') return 'payload_too_large';
    if (bounded.reason === 'unavailable') return 'request_unavailable';
    return 'invalid_payload';
  }

  return acceptPiggyvestStagingWebhook({
    configuration,
    rawPayload: bounded.body,
    signature: request.headers.get('x-pvb-signature'),
    inbox,
  });
}
