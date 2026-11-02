import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGiglWebhookBody } from './gigl-webhook-body';
import { GIGL_WEBHOOK_MAX_BODY_BYTES } from './gigl-webhook-limits';

vi.mock('server-only', () => ({}));

function streamOf(chunks: string[]): ReadableStream<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function requestWith(
  body: ReadableStream<Uint8Array<ArrayBuffer>> | null,
  headers: Record<string, string> = {}
) {
  return { body, headers: new Headers(headers) };
}

describe('readGiglWebhookBody', () => {
  afterEach(() => vi.useRealTimers());

  it('reads a chunked body within the cap', async () => {
    await expect(
      readGiglWebhookBody(requestWith(streamOf(['abc', 'def'])))
    ).resolves.toEqual({ ok: true, text: 'abcdef' });
  });

  it('treats a missing body as empty text', async () => {
    await expect(readGiglWebhookBody(requestWith(null))).resolves.toEqual({
      ok: true,
      text: '',
    });
  });

  it('rejects a declared length over the cap without reading', async () => {
    const body = streamOf(['never read']);

    await expect(
      readGiglWebhookBody(
        requestWith(body, {
          'content-length': String(GIGL_WEBHOOK_MAX_BODY_BYTES + 1),
        })
      )
    ).resolves.toEqual({ ok: false, reason: 'too_large' });
    expect(body.locked).toBe(false);
  });

  it('rejects a lengthless stream once it exceeds the cap', async () => {
    const half = 'x'.repeat(GIGL_WEBHOOK_MAX_BODY_BYTES / 2);

    await expect(
      readGiglWebhookBody(requestWith(streamOf([half, half, 'x'])))
    ).resolves.toEqual({ ok: false, reason: 'too_large' });
  });

  it('rejects a malformed content-length', async () => {
    await expect(
      readGiglWebhookBody(
        requestWith(streamOf(['abc']), { 'content-length': '12abc' })
      )
    ).resolves.toEqual({ ok: false, reason: 'unreadable' });
  });

  it('gives up on a stalled stream', async () => {
    vi.useFakeTimers();
    const stalled = new ReadableStream<Uint8Array<ArrayBuffer>>({ start() {} });

    const pending = readGiglWebhookBody(requestWith(stalled));
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });

  it('rejects a stream that errors mid-read', async () => {
    const failing = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        controller.error(new Error('socket reset'));
      },
    });

    await expect(readGiglWebhookBody(requestWith(failing))).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });
});
