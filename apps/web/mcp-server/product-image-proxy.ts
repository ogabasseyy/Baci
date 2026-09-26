import type { ServerResponse } from 'node:http';

const MAX_IMAGE_BYTES = 5_000_000;
const MAX_CONCURRENT_IMAGE_REQUESTS = 4;
const MAX_QUEUED_IMAGE_REQUESTS = 32;
const MAX_IMAGE_QUEUE_WAIT_MS = 12_000;
const PRODUCT_IMAGE_PREFIX = '/images/core-assets/products/';
const CDN_ORIGIN = 'https://cdn.ogabassey.com';
let activeImageRequests = 0;
const queuedImageRequests: Array<{ grant: () => void }> = [];

async function acquireImageSlot(response: ServerResponse): Promise<boolean> {
  if (response.destroyed) return false;
  if (activeImageRequests < MAX_CONCURRENT_IMAGE_REQUESTS) {
    activeImageRequests += 1;
    return true;
  }
  if (queuedImageRequests.length >= MAX_QUEUED_IMAGE_REQUESTS) return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      const index = queuedImageRequests.indexOf(waiter);
      if (index >= 0) queuedImageRequests.splice(index, 1);
      clearTimeout(timer);
      response.off('close', cancel);
      resolve(false);
    };
    const waiter = {
      grant: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        response.off('close', cancel);
        resolve(true);
      },
    };
    const timer = setTimeout(cancel, MAX_IMAGE_QUEUE_WAIT_MS);
    response.once('close', cancel);
    queuedImageRequests.push(waiter);
  });
}

function releaseImageSlot(): void {
  const next = queuedImageRequests.shift();
  if (next) next.grant();
  else activeImageRequests -= 1;
}

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
  fetchImage: typeof fetch = fetch,
  search = ''
): Promise<void> {
  if (
    !pathname.startsWith(PRODUCT_IMAGE_PREFIX) ||
    /%(?:2f|5c|2e)/i.test(pathname)
  ) {
    response.writeHead(404).end('Not Found');
    return;
  }

  if (!(await acquireImageSlot(response))) {
    if (!response.destroyed) {
      response.writeHead(503, { 'Retry-After': '1' }).end('Image service busy');
    }
    return;
  }

  try {
    if (response.destroyed) return;
    const assetPath = pathname.slice('/images'.length);
    const upstream = await fetchImage(
      `${CDN_ORIGIN}/image/width=640,quality=70,format=webp${assetPath}${search}`,
      { redirect: 'error', signal: AbortSignal.timeout(8000) }
    );
    const contentType = upstream.headers.get('content-type') || '';
    const contentLength = Number(upstream.headers.get('content-length'));
    if (!upstream.ok || !/^image\/(?:avif|jpeg|png|webp)(?:;|$)/i.test(contentType)) {
      await upstream.body?.cancel();
      response.writeHead(404).end('Not Found');
      return;
    }
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      await upstream.body?.cancel();
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
  } finally {
    releaseImageSlot();
  }
}
