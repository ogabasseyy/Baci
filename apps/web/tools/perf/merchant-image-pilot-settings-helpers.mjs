// Pure parse/extract helpers for the pilot effective-settings gate.
// Shared by the HAR and Lighthouse checks; no I/O, no subprocesses.

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const match = /^--([a-z-]+)=(.*)$/.exec(argv[i]);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
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
