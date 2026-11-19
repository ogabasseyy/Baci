/** Chat webhook payloads carry a whole conversation snapshot; still bounded. */
export const CHAT_WEBHOOK_BODY_MAX_BYTES = 512 * 1024;

export type ChatWebhookBodyResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'too_large' | 'unreadable' };

/**
 * Reads the raw request body as text, stopping as soon as the byte cap is
 * exceeded so an oversized or endless body is never fully buffered. The raw
 * text is what the signature covers, so it is returned unparsed.
 */
export async function readChatWebhookBody(
  request: Request,
  maxBytes: number = CHAT_WEBHOOK_BODY_MAX_BYTES
): Promise<ChatWebhookBodyResult> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: 'too_large' };
  }
  try {
    if (!request.body) {
      const text = await request.text();
      return new TextEncoder().encode(text).length > maxBytes
        ? { ok: false, reason: 'too_large' }
        : { ok: true, text };
    }
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
        return { ok: false, reason: 'too_large' };
      }
      text += decoder.decode(value, { stream: true });
    }
    return { ok: true, text: text + decoder.decode() };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
