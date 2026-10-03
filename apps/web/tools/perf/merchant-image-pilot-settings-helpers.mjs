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

// PNG IHDR: width/height as uint32BE at bytes 16..23. No image deps.
export function pngDimensions(buffer) {
  if (
    buffer.length < 24 ||
    buffer.readUInt32BE(0) !== 0x89504e47 ||
    buffer.readUInt32BE(4) !== 0x0d0a1a0a
  ) {
    throw new Error('not a PNG');
  }
  return { height: buffer.readUInt32BE(20), width: buffer.readUInt32BE(16) };
}

export function harUserAgent(har) {
  const headers = har?.log?.entries?.[0]?.request?.headers ?? [];
  const found = headers.find(
    (header) => String(header.name).toLowerCase() === 'user-agent'
  );
  return found ? String(found.value) : null;
}
