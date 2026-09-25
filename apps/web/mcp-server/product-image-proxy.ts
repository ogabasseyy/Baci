import type { ServerResponse } from 'node:http';

const MAX_IMAGE_BYTES = 5_000_000;
const PRODUCT_IMAGE_PREFIX = '/images/core-assets/products/';
const CDN_ORIGIN = 'https://cdn.ogabassey.com';

async function readBoundedImage(response: Response): Promise<Buffer | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, totalBytes);
      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function serveProductImage(
  pathname: string,
  response: ServerResponse,
  fetchImage: typeof fetch = fetch
): Promise<void> {
  if (
    !pathname.startsWith(PRODUCT_IMAGE_PREFIX) ||
    /%(?:2f|5c|2e)/i.test(pathname)
  ) {
    response.writeHead(404).end('Not Found');
    return;
  }

  try {
    const assetPath = pathname.slice('/images'.length);
    const upstream = await fetchImage(
      `${CDN_ORIGIN}/image/width=640,quality=70,format=webp${assetPath}`,
      { redirect: 'error', signal: AbortSignal.timeout(8000) }
    );
    const contentType = upstream.headers.get('content-type') || '';
    const contentLength = Number(upstream.headers.get('content-length'));
    if (!upstream.ok || !/^image\/(?:avif|jpeg|png|webp)(?:;|$)/i.test(contentType)) {
      response.writeHead(404).end('Not Found');
      return;
    }
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      response.writeHead(502).end('Image too large');
      return;
    }
    const image = await readBoundedImage(upstream);
    if (!image) {
      response.writeHead(502).end('Image too large');
      return;
    }
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': contentType,
    });
    response.end(image);
  } catch {
    response.writeHead(502).end('Image unavailable');
  }
}
