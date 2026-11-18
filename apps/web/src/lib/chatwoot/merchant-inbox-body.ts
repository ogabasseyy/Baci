/**
 * Bounded JSON body reader for the merchant inbox reply route. It stays free
 * of cart/env imports so the route's import graph never reaches credential
 * authority. A reply is at most 2,000 characters, so the byte cap is small.
 */
export const MERCHANT_INBOX_BODY_MAX_BYTES = 16 * 1024;

export type MerchantInboxBodyResult =
  | { ok: true; body: unknown }
  | { ok: false };

async function readCapped(
  request: Request,
  maxBytes: number
): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Oversized, empty or malformed JSON fails without throwing. */
export async function readMerchantInboxJsonBody(
  request: Request
): Promise<MerchantInboxBodyResult> {
  const text = await readCapped(request, MERCHANT_INBOX_BODY_MAX_BYTES);
  if (text === null || !text.trim()) return { ok: false };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
