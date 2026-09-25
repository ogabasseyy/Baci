import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { serveProductImage } from './product-image-proxy';

function createResponse() {
  const end = vi.fn();
  const writeHead = vi.fn(() => ({ end }));
  return {
    end,
    response: { writeHead, end } as unknown as ServerResponse,
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
});
