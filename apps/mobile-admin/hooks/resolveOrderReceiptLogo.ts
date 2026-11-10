import { sanitizeSvg } from '@baci/shared';
import { fetch } from 'expo/fetch';

const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_TIMEOUT_MS = 5000;

function trustedLogoUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return null;
  }
  if (
    (url.hostname === 'cdn.ogabassey.com' &&
      url.pathname.startsWith('/media/')) ||
    (url.hostname.endsWith('.supabase.co') &&
      /^\/storage\/v1\/object\/public\/(media|images)\//.test(url.pathname))
  ) {
    return url;
  }
  return null;
}

function rasterType(bytes: Uint8Array) {
  const prefix = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (prefix(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (prefix(255, 216, 255)) return 'image/jpeg';
  if (
    prefix(82, 73, 70, 70) &&
    bytes[8] === 87 &&
    bytes[9] === 69 &&
    bytes[10] === 66 &&
    bytes[11] === 80
  )
    return 'image/webp';
  return null;
}

export async function resolveOrderReceiptLogo(
  value: string | null | undefined
): Promise<{ logoUrl: string | null; svgXml?: string }> {
  const absent = { logoUrl: null };
  if (!value) return absent;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGO_TIMEOUT_MS);
  try {
    const url = trustedLogoUrl(value);
    if (!url) return absent;
    const response = await fetch(url.toString(), {
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    });
    if (
      !response.ok ||
      Number(response.headers.get('content-length')) > MAX_LOGO_BYTES ||
      !response.body
    ) {
      controller.abort();
      return absent;
    }

    const reader = response.body.getReader();
    const bytes = new Uint8Array(MAX_LOGO_BYTES);
    let size = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        if (size + chunk.byteLength > MAX_LOGO_BYTES) {
          controller.abort();
          return absent;
        }
        bytes.set(chunk, size);
        size += chunk.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    const logo = bytes.subarray(0, size);
    if (url.pathname.toLowerCase().endsWith('.svg')) {
      const svgXml = sanitizeSvg(new TextDecoder().decode(logo));
      return svgXml ? { logoUrl: null, svgXml } : absent;
    }
    const type = rasterType(logo);
    if (!type) return absent;

    let binary = '';
    for (const byte of logo) binary += String.fromCharCode(byte);
    return { logoUrl: `data:${type};base64,${btoa(binary)}` };
  } catch {
    return absent;
  } finally {
    clearTimeout(timer);
  }
}
