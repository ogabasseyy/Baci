// Pure parse/extract helpers for the pilot effective-settings gate.
// Shared by the HAR and Lighthouse checks; no I/O, no subprocesses.
// Runner-provenance validators live in settings-provenance.mjs.
import {
  parseArgs as parseStrictArgs,
  SETTINGS_CLI_OPTIONS,
} from './merchant-image-pilot-readiness-config.mjs';

// Single strict CLI parser shared with the readiness gate: unknown or
// malformed tokens throw instead of silently dropping caller intent.
export function parseArgs(argv) {
  return parseStrictArgs(argv, SETTINGS_CLI_OPTIONS);
}

export function parseDimensions(value, name) {
  const match = /^(\d+)x(\d+)$/.exec(String(value ?? ''));
  const width = match ? Number(match[1]) : Number.NaN;
  const height = match ? Number(match[2]) : Number.NaN;
  // Zero is not a viewport: --expect-viewport=0x0 would certify an
  // empty screenshot, so both axes must be positive like every other
  // geometry expectation.
  if (!match || width <= 0 || height <= 0) {
    throw new Error(`bad --${name}: ${value}`);
  }
  return { height, width };
}

// A non-numeric DPR would make every geometry comparison NaN (false) and
// silently pass the check, so reject it at parse time like dimensions.
export function parsePositiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`bad --${name}: ${value}`);
  }
  return parsed;
}

// Latency expectations admit zero (devtools requestLatencyMs: 0 is a real
// unthrottled profile); negatives and NaN still reject at parse time.
export function parseNonNegativeNumber(value, name) {
  // Number('') is 0: a blank flag value must reject, never pin zero.
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`bad --${name}: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`bad --${name}: ${value}`);
  }
  return parsed;
}

// Iteration counts must be positive integers: --expect-iterations=0 would
// let an empty HAR pass the iteration and connectivity checks vacuously.
export function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`bad --${name}: ${value}`);
  }
  return parsed;
}

// CRC-32 (ISO 3309) for PNG chunk validation. No image deps.
const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function pngCrc32(buffer, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = PNG_CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// PNG dimensions with full structure validation: a screenshot truncated
// or corrupted after its IHDR must not pass har.geometry on 24 header
// bytes alone. Walks every chunk, verifies each CRC, and requires IEND
// with no trailing garbage before the dimensions count as evidence.
export function pngDimensions(buffer) {
  if (
    buffer.length < 8 ||
    buffer.readUInt32BE(0) !== 0x89504e47 ||
    buffer.readUInt32BE(4) !== 0x0d0a1a0a
  ) {
    throw new Error('not a PNG');
  }
  let offset = 8;
  let dimensions = null;
  let seenIdat = false;
  let first = true;
  for (;;) {
    if (offset + 8 > buffer.length) {
      throw new Error('PNG is truncated');
    }
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const dataEnd = offset + 8 + length;
    if (dataEnd + 4 > buffer.length) {
      throw new Error('PNG is truncated');
    }
    if (
      pngCrc32(buffer, offset + 4, dataEnd) !== buffer.readUInt32BE(dataEnd)
    ) {
      throw new Error(`PNG chunk "${type}" failed its CRC check`);
    }
    if (first) {
      if (type !== 'IHDR' || length !== 13) {
        throw new Error('not a PNG');
      }
      dimensions = {
        height: buffer.readUInt32BE(20),
        width: buffer.readUInt32BE(16),
      };
      if (dimensions.width < 1 || dimensions.height < 1) {
        throw new Error('PNG dimensions must be positive');
      }
      first = false;
    }
    if (type === 'IDAT') {
      seenIdat = true;
    }
    offset = dataEnd + 4;
    if (type === 'IEND') {
      break;
    }
  }
  if (offset !== buffer.length) {
    throw new Error('PNG has trailing bytes after IEND');
  }
  // An IHDR followed directly by IEND is structurally valid but carries
  // no pixels: without IDAT it cannot be screenshot evidence.
  if (!seenIdat) {
    throw new Error('PNG has no image data (IDAT)');
  }
  return dimensions;
}

export function harUserAgent(har) {
  const headers = har?.log?.entries?.[0]?.request?.headers ?? [];
  const found = headers.find(
    (header) => String(header.name).toLowerCase() === 'user-agent'
  );
  return found ? String(found.value) : null;
}

// Cache-hit evidence in a HAR: a revalidation miss (304), any
// runner-recorded cache path (disk, prefetch, service worker), or a
// retained disk-cache marker (HARs built with cached resources kept carry
// entry.cache.beforeRequest). Cached resources can carry HTTP 200, so
// status alone never proves cold. Plain zero-byte entries (204s, data
// URLs) carry none of these signals and are not classified as cache.
export function findCacheHits(har) {
  return (har?.log?.entries ?? []).filter((entry) => {
    const response = entry?.response ?? {};
    return (
      response.status === 304 ||
      response.fromDiskCache === true ||
      response.fromPrefetchCache === true ||
      response.fromServiceWorker === true ||
      entry?.cache?.beforeRequest !== undefined
    );
  });
}

export function verifyHarIterations(pages, expectIterations) {
  if (pages.length !== expectIterations) {
    return {
      error: `recorded ${pages.length} runs, expected ${expectIterations}`,
      ok: false,
    };
  }
  return { ok: true };
}

export function verifyHarConnectivity(pages, expectConnectivity) {
  const bad = pages.filter(
    (page) => page?._meta?.connectivity !== expectConnectivity
  );
  if (bad.length > 0) {
    return {
      error: `recorded ${pages.map((page) => page?._meta?.connectivity).join(',')}, expected ${expectConnectivity}`,
      ok: false,
    };
  }
  return { ok: true };
}

// Navigation-route binding: every recorded page must be the expected
// navigation, by final URL (_url, else the title many runners record as
// the URL). Page count, connectivity, browser, and geometry cannot tell
// a wrong-store, wrong-arm, or redirected navigation from the intended
// one, and the screenshot/runId provenance binds artifacts to each
// other — not to the intended route. Exact href comparison after URL
// normalization, mirroring the sitespeed artifact gate.
export function verifyHarRoute(pages, expectRoute) {
  let expected;
  try {
    expected = new URL(expectRoute).href;
  } catch {
    return { error: `bad --expect-route: ${expectRoute}`, ok: false };
  }
  if (pages.length === 0) {
    return { error: 'HAR has no pages to bind to the route', ok: false };
  }
  for (const page of pages) {
    const finalUrl = page?._url || page?.title;
    if (!finalUrl) {
      return {
        error: 'HAR page carries no navigation URL (_url or title)',
        ok: false,
      };
    }
    let actual;
    try {
      actual = new URL(finalUrl).href;
    } catch {
      return {
        error: `HAR page navigation is not a valid URL: ${finalUrl}`,
        ok: false,
      };
    }
    if (actual !== expected) {
      return {
        error: `HAR page navigated ${actual}, expected ${expected}`,
        ok: false,
      };
    }
  }
  return { ok: true };
}

// Lighthouse navigation binding: the report's navigated URL and its
// redirect result must both be the expected route. Device and
// throttling settings cannot tell a matching-profile report for another
// store or comparison arm from the intended navigation, so a report
// with identical settings but wrong-page metrics would otherwise pass.
export function verifyLighthouseRoute(report, expectRoute) {
  let expected;
  try {
    expected = new URL(expectRoute).href;
  } catch {
    return { error: `bad --expect-route: ${expectRoute}`, ok: false };
  }
  for (const field of ['requestedUrl', 'finalDisplayedUrl']) {
    const value = report?.[field];
    if (!value) {
      return {
        error: `Lighthouse report has no ${field} to bind to the route`,
        ok: false,
      };
    }
    let actual;
    try {
      actual = new URL(value).href;
    } catch {
      return {
        error: `Lighthouse ${field} is not a valid URL: ${value}`,
        ok: false,
      };
    }
    if (actual !== expected) {
      return {
        error: `Lighthouse ${field} is ${actual}, expected ${expected}`,
        ok: false,
      };
    }
  }
  return { ok: true };
}

export function verifyBrowserVersion(version, expectMajor) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    return {
      error: `attested version "${version}" is not a dotted browser build`,
      ok: false,
    };
  }
  if (!version.startsWith(`${expectMajor}.`)) {
    return {
      error: `attested executable ${version} does not match Chrome ${expectMajor}`,
      ok: false,
    };
  }
  return { ok: true };
}
