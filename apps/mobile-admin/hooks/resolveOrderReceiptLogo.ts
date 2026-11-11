import { DEFAULT_MEDIA_CDN_ORIGIN, sanitizeSvg } from '@baci/shared';
import { fromByteArray } from 'base64-js';
import { fetch } from 'expo/fetch';
import { getConfiguredSupabaseUrl } from '@/lib/supabase-config';

const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_TIMEOUT_MS = 5000;

function trustedLogoUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return null;
  }
  if (
    url.origin === DEFAULT_MEDIA_CDN_ORIGIN &&
    url.pathname.startsWith('/media/')
  ) {
    return url;
  }
  const configuredUrl = getConfiguredSupabaseUrl();
  if (
    configuredUrl &&
    url.origin === new URL(configuredUrl).origin &&
    /^\/storage\/v1\/object\/public\/(media|images)\//.test(url.pathname)
  ) {
    return url;
  }
  return null;
}

const MAX_LOGO_PIXELS = 4_000_000;

function dimensionsFit(width: number, height: number) {
  return width > 0 && height > 0 && width * height <= MAX_LOGO_PIXELS;
}

function pngFits(data: DataView) {
  if (
    data.byteLength < 33 ||
    data.getUint32(8) !== 13 ||
    data.getUint32(12) !== 0x49484452 || // IHDR
    !dimensionsFit(data.getUint32(16), data.getUint32(20))
  ) {
    return false;
  }

  let hasImage = false;
  for (let offset = 33; offset + 12 <= data.byteLength; ) {
    const size = data.getUint32(offset);
    const type = data.getUint32(offset + 4);
    offset += size + 12; // length, type, contents and CRC
    if (offset > data.byteLength) return false;
    if (
      type === 0x49484452 || // duplicate IHDR
      type === 0x6163544c || // acTL
      type === 0x6663544c || // fcTL
      type === 0x66644154 // fdAT
    ) {
      return false;
    }
    if (type === 0x49444154 && size > 0) hasImage = true; // IDAT
    if (type === 0x49454e44) {
      // IEND
      return size === 0 && offset === data.byteLength && hasImage;
    }
  }
  return false;
}

function jpegFits(data: DataView) {
  if (data.getUint16(data.byteLength - 2) !== 0xffd9) return false;
  let hasFrame = false;
  for (let offset = 2; offset + 4 <= data.byteLength; ) {
    if (data.getUint8(offset++) !== 0xff) return false;
    while (offset < data.byteLength && data.getUint8(offset) === 0xff) offset++;
    if (offset + 3 > data.byteLength) return false;
    const marker = data.getUint8(offset++);
    const size = data.getUint16(offset);
    if (size < 2 || offset + size > data.byteLength) return false;
    if (marker === 0xda) return hasFrame && offset + size < data.byteLength - 2; // SOS
    if (
      marker === 0xe2 &&
      size >= 6 &&
      data.getUint32(offset + 2) === 0x4d504600
    ) {
      return false; // MPO contains multiple images.
    }
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrame) {
      if (
        hasFrame ||
        size < 8 ||
        !dimensionsFit(data.getUint16(offset + 5), data.getUint16(offset + 3))
      )
        return false;
      hasFrame = true;
    }
    offset += size;
  }
  return false;
}

function getUint24LE(data: DataView, offset: number) {
  return data.getUint16(offset, true) + data.getUint8(offset + 2) * 65536;
}

function webpFits(data: DataView) {
  if (data.getUint32(4, true) + 8 !== data.byteLength) return false;

  let hasFrame = false;
  let offset = 12;
  while (offset + 8 <= data.byteLength) {
    const type = data.getUint32(offset);
    const size = data.getUint32(offset + 4, true);
    const start = offset + 8;
    offset = start + size + (size % 2);
    if (offset > data.byteLength) return false;
    switch (type) {
      case 0x414e494d: // ANIM
      case 0x414e4d46: // ANMF
        return false;
      case 0x56503858: // VP8X
        if (
          start !== 20 ||
          size !== 10 ||
          (data.getUint8(start) & 2) !== 0 ||
          !dimensionsFit(
            1 + getUint24LE(data, start + 4),
            1 + getUint24LE(data, start + 7)
          )
        ) {
          return false;
        }
        break;
      case 0x56503820: // VP8 (lossy)
        if (
          hasFrame ||
          size < 10 ||
          data.getUint8(start + 3) !== 0x9d ||
          data.getUint16(start + 4) !== 0x012a ||
          !dimensionsFit(
            data.getUint16(start + 6, true) & 0x3fff,
            data.getUint16(start + 8, true) & 0x3fff
          )
        ) {
          return false;
        }
        hasFrame = true;
        break;
      case 0x5650384c: {
        // VP8L (lossless)
        if (hasFrame || size < 5 || data.getUint8(start) !== 0x2f) return false;
        const bits = data.getUint32(start + 1, true);
        if (!dimensionsFit(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)))
          return false;
        hasFrame = true;
        break;
      }
    }
  }
  return hasFrame && offset === data.byteLength;
}

/** Check the encoded dimensions and animation flags without decoding pixels. */
function rasterType(bytes: Uint8Array) {
  if (bytes.byteLength < 12) return null;
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.getUint32(0) === 0x89504e47 && data.getUint32(4) === 0x0d0a1a0a) {
    return pngFits(data) ? 'image/png' : null;
  }
  if (data.getUint16(0) === 0xffd8) return jpegFits(data) ? 'image/jpeg' : null;
  if (data.getUint32(0) === 0x52494646 && data.getUint32(8) === 0x57454250) {
    return webpFits(data) ? 'image/webp' : null;
  }
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
    const type = rasterType(logo);
    if (!type) {
      // Only hand actual SVG markup to the mobile preview. Server PDFs use
      // the seller name for SVG logos.
      const markup = new TextDecoder().decode(logo);
      const svgRoot =
        /^\s*(?:<\?xml[^?]*\?>\s*)?(?:<!--(?:[^-]|-(?!->))*-->\s*)*<svg[\s/>]/i;
      if (!svgRoot.test(markup)) return absent;
      const svgXml = sanitizeSvg(markup);
      return svgXml ? { logoUrl: null, svgXml } : absent;
    }

    return { logoUrl: `data:${type};base64,${fromByteArray(logo)}` };
  } catch {
    return absent;
  } finally {
    clearTimeout(timer);
  }
}
