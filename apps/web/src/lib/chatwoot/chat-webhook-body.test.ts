import { describe, expect, it } from 'vitest';
import { readChatWebhookBody } from './chat-webhook-body';

function request(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request('https://app.example.test/api/webhooks/chatwoot/key', {
    method: 'POST',
    body,
    headers,
  });
}

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('readChatWebhookBody', () => {
  it('returns the exact raw text, including multibyte characters', async () => {
    await expect(readChatWebhookBody(request('{"a":"é😀"}'))).resolves.toEqual({
      ok: true,
      text: '{"a":"é😀"}',
    });
  });

  it('refuses a declared length over the cap without reading', async () => {
    await expect(
      readChatWebhookBody(request('{}', { 'content-length': '999999' }), 10)
    ).resolves.toEqual({ ok: false, reason: 'too_large' });
  });

  it('stops a chunked body as soon as it passes the cap', async () => {
    const init = {
      method: 'POST',
      body: streamOf(['12345', '67890', 'x']),
      duplex: 'half',
    } as RequestInit;
    await expect(
      readChatWebhookBody(
        new Request('https://app.example.test/hook', init),
        10
      )
    ).resolves.toEqual({ ok: false, reason: 'too_large' });
  });

  it('counts bytes, not characters', async () => {
    await expect(readChatWebhookBody(request('ééééé'), 9)).resolves.toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('accepts an empty body as empty text', async () => {
    await expect(readChatWebhookBody(request(null))).resolves.toEqual({
      ok: true,
      text: '',
    });
  });
});
