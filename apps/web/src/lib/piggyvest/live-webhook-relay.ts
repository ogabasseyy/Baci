import 'server-only';
import { createHash } from 'node:crypto';
import { piggyvestLiveRelaySchemas as schemas } from '@/schemas/piggyvest-live-relay';
import { LIVE_RELAY_LIMITS as limits } from './live-relay-limits';

function reply(status: number, received: boolean): Response {
  return Response.json(
    { received },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}

async function readAcknowledgement(response: Response, signal: AbortSignal) {
  if (!response.body || response.status !== 200) throw new Error('Unavailable');
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > limits.responseBytes)
  )
    throw new Error('Unavailable');
  const reader = response.body.getReader();
  let rejectRead: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectRead = () => reject(new Error('Unavailable'));
  });
  const onAbort = () => rejectRead?.();
  signal.addEventListener('abort', onAbort, { once: true });
  const bytes = new Uint8Array(limits.responseBytes);
  let length = 0;
  let reads = 0;
  let complete = false;
  try {
    if (signal.aborted) throw new Error('Unavailable');
    while (true) {
      const chunk = await Promise.race([reader.read(), interrupted]);
      if (chunk.done) {
        complete = true;
        break;
      }
      length += chunk.value.byteLength;
      reads++;
      if (length > limits.responseBytes || reads > limits.responseBytes)
        throw new Error('Unavailable');
      bytes.set(chunk.value, length - chunk.value.byteLength);
    }
    return schemas.acknowledgement.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          bytes.subarray(0, length)
        )
      )
    );
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function forwardLiveWebhook(input: {
  rawBody: Uint8Array;
  signature: string | null;
  config: unknown;
  fetchImplementation?: typeof fetch;
}): Promise<Response> {
  const parsed = schemas.config.safeParse(input.config);
  if (!parsed.success) return reply(503, false);
  if (!input.rawBody.byteLength || input.rawBody.byteLength > limits.bodyBytes)
    return reply(413, false);
  if (!input.signature || !/^[a-f0-9]{128}$/i.test(input.signature))
    return reply(200, false);
  const config = parsed.data;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    const upstream = await (input.fetchImplementation ?? fetch)(
      config.endpoint,
      {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.relayToken}`,
          'Content-Type': 'application/octet-stream',
          'x-pvb-signature': input.signature.toLowerCase(),
        },
        body: Buffer.from(input.rawBody),
      }
    );
    const ack = await readAcknowledgement(upstream, controller.signal);
    const digest = createHash('sha256').update(input.rawBody).digest('hex');
    if (
      ack.integrationId !== config.integrationId ||
      ack.bodyDigest !== digest ||
      ack.outcome === 'unavailable'
    )
      return reply(503, false);
    return reply(200, ack.outcome !== 'invalid_signature');
  } catch {
    console.warn('[PiggyVest relay] Request unavailable', {
      timedOut: controller.signal.aborted,
    });
    return reply(503, false);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
