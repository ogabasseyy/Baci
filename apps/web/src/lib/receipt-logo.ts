import type { ReceiptMerchant } from '@baci/shared';
import { DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';

const MAX_LOGO_BYTES = 256 * 1024;
const MAX_LOGO_DATA_URI_LENGTH = MAX_LOGO_BYTES * 2;
const LOGO_FETCH_TIMEOUT_MS = 5000;
const SUPABASE_HOST_SUFFIX = '.supabase.co';
const SUPABASE_PUBLIC_LOGO_PREFIXES = [
  '/storage/v1/object/public/media/',
  '/storage/v1/object/public/images/',
];
const MEDIA_CDN_PUBLIC_PREFIX = '/media/';
const TRUSTED_MEDIA_CDN_HOSTNAME = new URL(DEFAULT_MEDIA_CDN_ORIGIN).hostname;

function isSupportedLogoContentType(contentType: string) {
  return (
    contentType.startsWith('image/png') ||
    contentType.startsWith('image/jpeg') ||
    contentType.startsWith('image/jpg') ||
    contentType.startsWith('image/webp')
  );
}

function isTrustedLogoUrl(parsedUrl: URL) {
  if (parsedUrl.protocol !== 'https:') {
    return false;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    hostname === TRUSTED_MEDIA_CDN_HOSTNAME &&
    parsedUrl.pathname.startsWith(MEDIA_CDN_PUBLIC_PREFIX)
  ) {
    return true;
  }

  return (
    hostname.endsWith(SUPABASE_HOST_SUFFIX) &&
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

function encodeLogoBytesToBase64(bytes: Uint8Array) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triplet = (first << 16) | (second << 8) | third;

    encoded += alphabet[(triplet >> 18) & 63];
    encoded += alphabet[(triplet >> 12) & 63];
    encoded += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : '=';
    encoded += index + 2 < bytes.length ? alphabet[triplet & 63] : '=';
  }

  return encoded;
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
    return logoUrl.length <= MAX_LOGO_DATA_URI_LENGTH ? logoUrl : null;
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

    const contentType = response.headers.get('content-type') || '';
    if (!isSupportedLogoContentType(contentType)) return null;

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_LOGO_BYTES) return null;

    const imageBytes = await readLogoBytes(response);
    if (!imageBytes) return null;

    const base64 = encodeLogoBytesToBase64(imageBytes);
    return `data:${contentType.split(';')[0]};base64,${base64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
