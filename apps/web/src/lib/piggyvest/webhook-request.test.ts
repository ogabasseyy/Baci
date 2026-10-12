import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptPiggyvestStagingRequest,
  readBoundedWebhookBody,
} from './webhook-request';

const configuration = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  secret: 'synthetic-secret',
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  rawByteSignatureVerified: true,
  durableAcknowledgementApproved: true,
};
const bytes = new TextEncoder().encode(
  JSON.stringify({
    eventId: 'synthetic-event',
    customer_id: 'synthetic-customer',
    eventType: 'synthetic.unsupported',
    eventCategory: 'synthetic',
    eventData: {},
  })
);
function setup(
  body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  })
) {
  return {
    configuration,
    request: {
      headers: new Headers({
        'content-type': 'application/json',
        'x-pvb-signature': createHmac('sha512', configuration.secret)
          .update(bytes)
          .digest('hex'),
      }),
      body,
      signal: new AbortController().signal,
    },
    inbox: { enqueue: vi.fn(async () => 'accepted' as const) },
  };
}

describe('acceptPiggyvestStagingRequest', () => {
  afterEach(() => vi.useRealTimers());

  it('reads exact bytes before authenticated durable acceptance', async () => {
    const input = setup();
    expect(await acceptPiggyvestStagingRequest(input)).toBe('accepted');
    expect(input.inbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it('accepts a quoted UTF-8 charset without altering signed bytes', async () => {
    const input = setup();
    input.request.headers.set(
      'content-type',
      'application/json; charset="utf-8"'
    );
    expect(await acceptPiggyvestStagingRequest(input)).toBe('accepted');
  });

  it('does not read a request when staging configuration is disabled', async () => {
    const input = { ...setup(), configuration: undefined };
    expect(await acceptPiggyvestStagingRequest(input)).toBe('not_ready');
    expect(input.request.body.locked).toBe(false);
    expect(input.inbox.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    'gzip',
    'br',
  ])('rejects content encoding %s instead of changing signed bytes', async (encoding) => {
    const input = setup();
    input.request.headers.set('content-encoding', encoding);
    expect(await acceptPiggyvestStagingRequest(input)).toBe('invalid_payload');
    expect(input.inbox.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    'text/plain',
    'application/json; charset=iso-8859-1',
  ])('rejects unsupported content type %s', async (contentType) => {
    const input = setup();
    input.request.headers.set('content-type', contentType);
    expect(await acceptPiggyvestStagingRequest(input)).toBe('invalid_payload');
  });

  it('enforces actual streamed size even when declared length is small', async () => {
    const input = setup(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(65537));
          controller.close();
        },
      })
    );
    input.request.headers.set('content-length', '1');
    expect(await acceptPiggyvestStagingRequest(input)).toBe(
      'payload_too_large'
    );
    expect(input.inbox.enqueue).not.toHaveBeenCalled();
  });

  it('does not wait indefinitely for a stalled body or cancellation', async () => {
    vi.useFakeTimers();
    const input = setup(
      new ReadableStream({ cancel: () => new Promise(() => undefined) })
    );
    const result = acceptPiggyvestStagingRequest(input);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBe('request_unavailable');
    expect(input.inbox.enqueue).not.toHaveBeenCalled();
  });

  it('limits the accumulated size across individually small chunks', async () => {
    const input = setup(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(32768));
          controller.enqueue(new Uint8Array(32769));
          controller.close();
        },
      })
    );
    expect(await acceptPiggyvestStagingRequest(input)).toBe(
      'payload_too_large'
    );
    expect(input.inbox.enqueue).not.toHaveBeenCalled();
  });

  it('redacts a stream read rejection without enqueueing partial data', async () => {
    const input = setup(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('sensitive stream failure'));
        },
      })
    );
    expect(await acceptPiggyvestStagingRequest(input)).toBe(
      'request_unavailable'
    );
    expect(input.inbox.enqueue).not.toHaveBeenCalled();
  });

  it('returns a safe outcome on client abort', async () => {
    const abort = new AbortController();
    const input = setup(new ReadableStream());
    input.request.signal = abort.signal;
    const result = acceptPiggyvestStagingRequest(input);
    abort.abort();
    expect(await result).toBe('request_unavailable');
    expect(input.inbox.enqueue).not.toHaveBeenCalled();
  });

  it('bounds empty chunks rather than retaining unlimited stream entries', async () => {
    let pulls = 0;
    const input = setup(
      new ReadableStream({
        pull(controller) {
          pulls += 1;
          if (pulls <= 65537) controller.enqueue(new Uint8Array());
          else {
            controller.enqueue(bytes);
            controller.close();
          }
        },
      })
    );
    expect(await acceptPiggyvestStagingRequest(input)).toBe('invalid_payload');
    expect(input.inbox.enqueue).not.toHaveBeenCalled();
  });
});

describe('readBoundedWebhookBody', () => {
  it('rejects a declared length over the shared limit without reading', async () => {
    const getReader = vi.fn(() => {
      throw new Error('must not read');
    });
    const result = await readBoundedWebhookBody({
      headers: new Headers({ 'content-length': String(64 * 1024 + 1) }),
      body: { getReader } as never,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ ok: false, reason: 'too_large' });
    expect(getReader).not.toHaveBeenCalled();
  });

  it('rejects a malformed declared length', async () => {
    const result = await readBoundedWebhookBody({
      headers: new Headers({ 'content-length': 'many' }),
      body: new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reads an empty body as zero bytes', async () => {
    const result = await readBoundedWebhookBody({
      headers: new Headers(),
      body: null,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ ok: true, body: Buffer.alloc(0) });
  });
});
