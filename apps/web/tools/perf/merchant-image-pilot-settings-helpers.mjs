// Pure parse/extract helpers for the pilot effective-settings gate.
// Shared by the HAR and Lighthouse checks; no I/O, no subprocesses.
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

function pngCrc32(buffer, start, end) {
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
      first = false;
    }
    offset = dataEnd + 4;
    if (type === 'IEND') {
      break;
    }
  }
  if (offset !== buffer.length) {
    throw new Error('PNG has trailing bytes after IEND');
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
