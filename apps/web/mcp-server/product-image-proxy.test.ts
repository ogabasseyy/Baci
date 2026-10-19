import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { serveProductImage } from './product-image-proxy';

function createResponse() {
  const end = vi.fn();
  const writeHead = vi.fn(() => ({ end }));
  const emitter = new EventEmitter();
  const mockedResponse = Object.assign(emitter, { writeHead, end, destroyed: false });
  return {
    end,
    close: () => {
      mockedResponse.destroyed = true;
      emitter.emit('close');
    },
    response: mockedResponse as unknown as ServerResponse,
    writeHead,
  };
}

describe('serveProductImage', () => {
  it('fetches only the fixed product CDN path and returns an image', async () => {
    const { end, response, writeHead } = createResponse();
    const fetchImage = vi.fn(async () => new Response('image bytes', {
      headers: { 'content-type': 'image/webp' },
    })) as unknown as typeof fetch;

    await serveProductImage('/images/core-assets/products/phone.webp', response, fetchImage);

    expect(fetchImage).toHaveBeenCalledWith(
      'https://cdn.ogabassey.com/image/width=640,quality=70,format=webp/core-assets/products/phone.webp',
      expect.objectContaining({ redirect: 'error' })
    );
    expect(writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'image/webp',
    }));
    expect(end).toHaveBeenCalledWith(Buffer.from('image bytes'));
  });

  it('forwards a version query to the fixed CDN transform', async () => {
    const { response } = createResponse();
    const fetchImage = vi.fn(async () => new Response('image bytes', {
      headers: { 'content-type': 'image/webp' },
    })) as unknown as typeof fetch;

    await serveProductImage('/images/core-assets/products/phone.webp', response, fetchImage, '?v=2');

    expect(fetchImage).toHaveBeenCalledWith(
      'https://cdn.ogabassey.com/image/width=640,quality=70,format=webp/core-assets/products/phone.webp?v=2',
      expect.objectContaining({ redirect: 'error' })
    );
  });

  it('ignores arbitrary and invalid image query parameters', async () => {
    const fetchImage = vi.fn(async () => new Response('image bytes', {
      headers: { 'content-type': 'image/webp' },
    })) as unknown as typeof fetch;
    for (const search of ['?x=random', '?v=2&x=random', '?v=too-long-a-version-value-that-should-be-rejected']) {
      const { response } = createResponse();
      await serveProductImage('/images/core-assets/products/phone.webp', response, fetchImage, search);
    }
    expect(fetchImage).toHaveBeenNthCalledWith(1,
      'https://cdn.ogabassey.com/image/width=640,quality=70,format=webp/core-assets/products/phone.webp',
      expect.anything());
    expect(fetchImage).toHaveBeenNthCalledWith(2,
      'https://cdn.ogabassey.com/image/width=640,quality=70,format=webp/core-assets/products/phone.webp?v=2',
      expect.anything());
    expect(fetchImage).toHaveBeenNthCalledWith(3,
      'https://cdn.ogabassey.com/image/width=640,quality=70,format=webp/core-assets/products/phone.webp',
      expect.anything());
  });

  it('rejects paths outside the product prefix and encoded path separators', async () => {
    const fetchImage = vi.fn() as unknown as typeof fetch;
    for (const pathname of [
      '/images/private/file.webp',
      '/images/core-assets/products/%2e%2e/private.webp',
      '/images/core-assets/products/a%2fb.webp',
    ]) {
      const { response, writeHead } = createResponse();
      await serveProductImage(pathname, response, fetchImage);
      expect(writeHead).toHaveBeenCalledWith(404);
    }
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('rejects non-images and oversized streams without returning their bytes', async () => {
    const wrongType = createResponse();
    await serveProductImage(
      '/images/core-assets/products/phone.webp',
      wrongType.response,
      vi.fn(async () => new Response('html', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    );
    expect(wrongType.writeHead).toHaveBeenCalledWith(404);

    const oversized = createResponse();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3_000_000));
        controller.enqueue(new Uint8Array(3_000_000));
      },
    });
    await serveProductImage(
      '/images/core-assets/products/phone.webp',
      oversized.response,
      vi.fn(async () => new Response(stream, { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch
    );
    expect(oversized.writeHead).toHaveBeenCalledWith(502);
    expect(oversized.end).toHaveBeenCalledWith('Image too large');
  });

  it('cancels a slow rejected upstream body before releasing its slot', async () => {
    const canceled = vi.fn();
    const upstream = new Response(new ReadableStream<Uint8Array>({
      cancel: canceled,
    }), { status: 404, headers: { 'content-type': 'text/html' } });
    const { response, writeHead } = createResponse();

    await serveProductImage(
      '/images/core-assets/products/missing.webp',
      response,
      vi.fn(async () => upstream) as unknown as typeof fetch
    );

    expect(canceled).toHaveBeenCalledOnce();
    expect(writeHead).toHaveBeenCalledWith(404);
  });

  it('queues a six-card image burst behind four active fetches', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchImage = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))) as unknown as typeof fetch;
    const responses = Array.from({ length: 6 }, createResponse);
    const requests = responses.map(({ response }) =>
      serveProductImage('/images/core-assets/products/phone.webp', response, fetchImage)
    );
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(4));
    expect(responses.slice(4).every(({ writeHead }) => writeHead.mock.calls.length === 0)).toBe(true);

    for (const resolve of pending.slice(0, 4)) {
      resolve(new Response('image bytes', { headers: { 'content-type': 'image/webp' } }));
    }
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(6));
    for (const resolve of pending.slice(4)) {
      resolve(new Response('image bytes', { headers: { 'content-type': 'image/webp' } }));
    }
    await Promise.all(requests);
    for (const { writeHead } of responses) {
      expect(writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    }
  });

  it('rejects requests beyond the bounded queue and drains admitted requests', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchImage = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))) as unknown as typeof fetch;
    const admitted = Array.from({ length: 36 }, createResponse);
    const requests = admitted.map(({ response }) =>
      serveProductImage('/images/core-assets/products/phone.webp', response, fetchImage)
    );
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(4));

    const overflow = createResponse();
    await serveProductImage('/images/core-assets/products/phone.webp', overflow.response, fetchImage);
    expect(overflow.writeHead).toHaveBeenCalledWith(503, { 'Retry-After': '1' });

    for (let start = 0; start < 36; start += 4) {
      for (const resolve of pending.slice(start, start + 4)) {
        resolve(new Response('image bytes', { headers: { 'content-type': 'image/webp' } }));
      }
      if (start + 4 < 36) {
        await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(start + 8));
      }
    }
    await Promise.all(requests);
    expect(admitted.every(({ writeHead }) => writeHead.mock.calls[0]?.[0] === 200)).toBe(true);
  });

  it('removes a queued image request when its client disconnects', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchImage = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))) as unknown as typeof fetch;
    const active = Array.from({ length: 4 }, createResponse);
    const activeRequests = active.map(({ response }) =>
      serveProductImage('/images/core-assets/products/phone.webp', response, fetchImage)
    );
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(4));

    const disconnected = createResponse();
    const queued = serveProductImage('/images/core-assets/products/phone.webp', disconnected.response, fetchImage);
    disconnected.close();
    await queued;
    expect(disconnected.writeHead).not.toHaveBeenCalled();

    for (const resolve of pending) {
      resolve(new Response('image bytes', { headers: { 'content-type': 'image/webp' } }));
    }
    await Promise.all(activeRequests);
    expect(fetchImage).toHaveBeenCalledTimes(4);
  });

  it('aborts an active CDN request and frees its slot when the client disconnects', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchImage = vi.fn((_url: string, options?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        pending.push(resolve);
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })
    ) as unknown as typeof fetch;
    const active = Array.from({ length: 4 }, createResponse);
    const activeRequests = active.map(({ response }) =>
      serveProductImage('/images/core-assets/products/phone.webp', response, fetchImage)
    );
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(4));
    const waiting = createResponse();
    const waitingRequest = serveProductImage('/images/core-assets/products/phone.webp', waiting.response, fetchImage);

    active[0].close();
    await activeRequests[0];
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(5));
    expect(active[0].writeHead).not.toHaveBeenCalled();

    for (const resolve of pending.slice(1)) {
      resolve(new Response('image bytes', { headers: { 'content-type': 'image/webp' } }));
    }
    await Promise.all([...activeRequests.slice(1), waitingRequest]);
    expect(waiting.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });

  it('times out a queued request without consuming a later slot', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchImage = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))) as unknown as typeof fetch;
    const activeRequests = Array.from({ length: 4 }, createResponse).map(({ response }) =>
      serveProductImage('/images/core-assets/products/phone.webp', response, fetchImage)
    );
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(4));
    const timedOut = createResponse();
    vi.useFakeTimers();
    try {
      const queued = serveProductImage('/images/core-assets/products/phone.webp', timedOut.response, fetchImage);
      await vi.advanceTimersByTimeAsync(12_000);
      await queued;
      expect(timedOut.writeHead).toHaveBeenCalledWith(503, { 'Retry-After': '1' });
    } finally {
      vi.useRealTimers();
      for (const resolve of pending) {
        resolve(new Response('image bytes', { headers: { 'content-type': 'image/webp' } }));
      }
      await Promise.all(activeRequests);
    }
    expect(fetchImage).toHaveBeenCalledTimes(4);
  });
});
