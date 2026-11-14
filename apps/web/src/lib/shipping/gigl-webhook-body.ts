import 'server-only';

import {
  GIGL_WEBHOOK_MAX_BODY_BYTES,
  GIGL_WEBHOOK_READ_TIMEOUT_MS,
} from './gigl-webhook-limits';

export type GiglWebhookBodyResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'too_large' | 'unreadable' };

/**
 * Reads the request body with a byte cap and a deadline before any
 * decryption work. The edge proxy only rejects declared lengths over 2 MiB,
 * so a lengthless stream must not be buffered unboundedly here.
 */
export async function readGiglWebhookBody(
  request: Pick<Request, 'body' | 'headers'>
): Promise<GiglWebhookBodyResult> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) return { ok: false, reason: 'unreadable' };
    if (Number(declared) > GIGL_WEBHOOK_MAX_BODY_BYTES) {
      return { ok: false, reason: 'too_large' };
    }
  }
  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), GIGL_WEBHOOK_READ_TIMEOUT_MS);
  });

  try {
    while (true) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next === 'timeout') return { ok: false, reason: 'unreadable' };
      if (next.done) break;
      length += next.value.byteLength;
      if (length > GIGL_WEBHOOK_MAX_BODY_BYTES) {
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(next.value);
    }
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }

  return { ok: true, text: Buffer.concat(chunks, length).toString('utf8') };
}
