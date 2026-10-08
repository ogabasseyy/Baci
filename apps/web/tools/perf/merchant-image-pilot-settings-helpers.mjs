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
  if (!match) {
    throw new Error(`bad --${name}: ${value}`);
  }
  return { height: Number(match[2]), width: Number(match[1]) };
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
