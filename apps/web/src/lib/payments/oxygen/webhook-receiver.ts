import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';
import { type OxygenWebhookEvent, parseOxygenWebhook } from './webhook';

export type OxygenCallbackConfiguration = {
  partnerReference: string;
  auth:
    | { mode: 'API_KEY' | 'BASIC'; apiKey: string; apiSecret: string }
    | { mode: 'BEARER'; apiKey: string };
};

/**
 * The adapter must atomically persist/enqueue authenticated events before returning.
 * Scope deduplication keys to this configured partner AND environment. Settlement
 * event IDs and transaction references have separate namespaces. A duplicate must
 * not enqueue financial effects again. Address notifications trigger a KYC read.
 * No public route or database privilege is granted by this portable receiver.
 */
export type AcceptOxygenWebhook = (
  event: OxygenWebhookEvent
) => Promise<'accepted' | 'duplicate'>;

function equalSecret(actual: string | null, expected: string): boolean {
  if (!actual || !expected) return false;
  return timingSafeEqual(
    createHash('sha256').update(actual).digest(),
    createHash('sha256').update(expected).digest()
  );
}

function authenticate(
  headers: Headers,
  auth: OxygenCallbackConfiguration['auth']
): boolean {
  if (auth.mode === 'API_KEY') {
    const keyMatches = equalSecret(headers.get('api_key'), auth.apiKey);
    const secretMatches = equalSecret(
      headers.get('api_secret'),
      auth.apiSecret
    );
    return keyMatches && secretMatches;
  }
  const expected =
    auth.mode === 'BEARER'
      ? `Bearer ${auth.apiKey}`
      : `Basic ${Buffer.from(`${auth.apiKey}:${auth.apiSecret}`).toString('base64')}`;
  return equalSecret(headers.get('authorization'), expected);
}

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function receiveOxygenWebhook(
  request: Request,
  configuration: OxygenCallbackConfiguration,
  accept: AcceptOxygenWebhook
): Promise<Response> {
  if (request.method !== 'POST') return error('Method not allowed', 405);
  const { auth, partnerReference } = configuration;
  if (
    !partnerReference.trim() ||
    !auth.apiKey.trim() ||
    ('apiSecret' in auth && !auth.apiSecret.trim())
  ) {
    return error('Callback unavailable', 503);
  }
  if (!authenticate(request.headers, auth)) return error('Unauthorized', 401);
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  ) {
    return error('JSON required', 415);
  }
  // Bound the actual stream, not just a potentially missing/incorrect length header.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 262144) {
          await reader.cancel();
          return error('Payload too large', 413);
        }
        chunks.push(next.value);
      }
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const event = parseOxygenWebhook(JSON.parse(body) as unknown);
    if (!event) return error('Invalid callback', 400);
    if (
      event.kind === 'settlement' &&
      event.partnerReference !== partnerReference
    ) {
      return error('Callback partner mismatch', 403);
    }
    try {
      const result = await accept(event);
      if (result !== 'accepted' && result !== 'duplicate') {
        return error('Callback unavailable', 503);
      }
      return Response.json({ received: true });
    } catch {
      // Do not acknowledge lost persistence; permit provider retry. No raw error logs.
      return error('Callback unavailable', 503);
    }
  } catch {
    return error('Invalid callback', 400);
  } finally {
    reader?.releaseLock();
  }
}
