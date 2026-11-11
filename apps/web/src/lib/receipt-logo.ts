import type { ReceiptMerchant } from '@baci/shared';
import sharp from 'sharp';
import { DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';

const MAX_LOGO_BYTES = 256 * 1024;
const MAX_LOGO_DATA_URI_LENGTH = MAX_LOGO_BYTES * 2;
const LOGO_FETCH_TIMEOUT_MS = 5000;
const SUPABASE_PUBLIC_LOGO_PREFIXES = [
  '/storage/v1/object/public/media/',
  '/storage/v1/object/public/images/',
];
const MEDIA_CDN_PUBLIC_PREFIX = '/media/';

function isTrustedLogoUrl(parsedUrl: URL) {
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.port ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    return false;
  }

  if (
    parsedUrl.origin === DEFAULT_MEDIA_CDN_ORIGIN &&
    parsedUrl.pathname.startsWith(MEDIA_CDN_PUBLIC_PREFIX)
  ) {
    return true;
  }

  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(
    configuredUrl &&
      URL.canParse(configuredUrl) &&
      parsedUrl.origin === new URL(configuredUrl).origin &&
      SUPABASE_PUBLIC_LOGO_PREFIXES.some((prefix) =>
        parsedUrl.pathname.startsWith(prefix)
      )
  );
}

function mergeLogoChunks(chunks: Uint8Array[], totalBytes: number) {
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

const MAX_LOGO_PIXELS = 4_000_000;
const RASTER_DATA_URI =
  /^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/]+={0,2})$/i;

async function isSafeLogo(bytes: Buffer, format: string) {
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) return false;
  try {
    const metadata = await sharp(bytes, {
      limitInputPixels: MAX_LOGO_PIXELS,
    }).metadata();
    return (
      metadata.format === (format === 'jpg' ? 'jpeg' : format) &&
      Boolean(
        metadata.width &&
          metadata.height &&
          metadata.width * metadata.height <= MAX_LOGO_PIXELS
      ) &&
      (metadata.pages ?? 1) === 1
    );
  } catch {
    return false;
  }
}

/** Accept only bounded, single-frame raster images for browser PDF export. */
export async function validateReceiptLogoDataUri(
  value: string | null | undefined
) {
  if (!value || value.length > MAX_LOGO_DATA_URI_LENGTH) return null;
  const match = RASTER_DATA_URI.exec(value);
  if (!match) return null;
  return (await isSafeLogo(
    Buffer.from(match[2], 'base64'),
    match[1].toLowerCase()
  ))
    ? value
    : null;
}

async function readLogoBytes(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_LOGO_BYTES) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return mergeLogoChunks(chunks, totalBytes);
}

export async function resolveReceiptLogoDataUri(merchant: ReceiptMerchant) {
  const logoUrl = merchant.logo_url?.trim();
  if (!logoUrl) return null;

  if (logoUrl.startsWith('data:image/')) {
    return validateReceiptLogoDataUri(logoUrl);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(logoUrl);
  } catch {
    return null;
  }

  if (!isTrustedLogoUrl(parsedUrl)) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(parsedUrl, {
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_LOGO_BYTES) return null;

    const imageBytes = await readLogoBytes(response);
    if (!imageBytes) return null;

    const bytes = Buffer.from(imageBytes);
    const format = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : bytes[0] === 0xff && bytes[1] === 0xd8
        ? 'jpeg'
        : bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP'
          ? 'webp'
          : null;
    return format && (await isSafeLogo(bytes, format))
      ? `data:image/${format};base64,${bytes.toString('base64')}`
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
