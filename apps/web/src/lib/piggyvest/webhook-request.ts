import 'server-only';
import { piggyvestWebhookIntakeConfigurationSchema } from '@/schemas/piggyvest-webhook-intake';
import type {
  PiggyvestWebhookInbox,
  PiggyvestWebhookIntakeOutcome,
} from './webhook-inbox.types';
import { acceptPiggyvestStagingWebhook } from './webhook-intake';
import { PIGGYVEST_WEBHOOK_LIMITS } from './webhook-limits';

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
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && !/^\d+$/.test(declaredLength)) {
    return 'invalid_payload';
  }
  if (Number(declaredLength) > PIGGYVEST_WEBHOOK_LIMITS.maxPayloadBytes) {
    return 'payload_too_large';
  }
  if (request.signal.aborted) return 'request_unavailable';

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return 'request_unavailable';
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
        return 'invalid_payload';
      }
      length += chunk.value.byteLength;
      if (length > PIGGYVEST_WEBHOOK_LIMITS.maxPayloadBytes) {
        return 'payload_too_large';
      }
      rawPayload.set(chunk.value, length - chunk.value.byteLength);
    }
  } catch {
    return 'request_unavailable';
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', onAbort);
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  return acceptPiggyvestStagingWebhook({
    configuration,
    rawPayload: rawPayload.subarray(0, length),
    signature: request.headers.get('x-pvb-signature'),
    inbox,
  });
}
