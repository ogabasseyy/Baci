// Killable single-operation Sharp worker: the op handlers. The parent
// (encoder.mjs) spawns one process per native operation via
// encode-worker-main.mjs with a JSON op in argv[2]; the worker prints a
// single JSON result to stdout. Handled outcomes (including input rejections)
// exit 0 with { ok: true|false }; protocol misuse or unexpected crashes exit
// non-zero so the parent can distinguish rejection from worker failure.
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import sharp from 'sharp';
import {
  ACCEPTED_INPUT_FORMATS,
  ENCODER_OPTIONS,
  MAX_AXIS_PIXELS,
  MAX_DECODED_PIXELS,
  MAX_INPUT_BYTES,
  SHARP_LIMITS,
} from './constants.mjs';
import { readUpToBytes, sha256File } from './disk-guards.mjs';
import {
  normalizeFormat,
  orientedDimensions,
} from './encode-worker-formats.mjs';

export { errorMessage, normalizeFormat, orientedDimensions };

export class WorkerInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'WorkerInputError';
  }
}

export function assertDecodedFormat(meta, expectedFormat) {
  const decodedFormat = normalizeFormat(meta);
  if (decodedFormat !== expectedFormat) {
    throw new WorkerInputError(
      'verify-failed',
      `expected ${expectedFormat} output, decoded ${meta?.format ?? 'unknown'} (compression ${meta?.compression ?? 'unknown'})`
    );
  }
  return decodedFormat;
}

export function assertAcceptedMetadata(meta) {
  if (!meta || !meta.width || !meta.height) {
    throw new WorkerInputError('unreadable-input', 'missing image dimensions');
  }
  const format = normalizeFormat(meta);
  if (!ACCEPTED_INPUT_FORMATS.includes(format)) {
    throw new WorkerInputError(
      'unsupported-format',
      `unsupported input format "${meta.format ?? 'unknown'}"`
    );
  }
  if ((meta.pages ?? 1) > 1) {
    throw new WorkerInputError(
      'animated-input',
      'animated input is rejected; no first-frame extraction'
    );
  }
  if (meta.width > MAX_AXIS_PIXELS || meta.height > MAX_AXIS_PIXELS) {
    throw new WorkerInputError(
      'dimensions-too-large',
      `dimensions ${meta.width}x${meta.height} exceed the axis limit`
    );
  }
  if (meta.width * meta.height > MAX_DECODED_PIXELS) {
    throw new WorkerInputError(
      'pixels-too-large',
      'decoded pixel area exceeds the limit'
    );
  }
  if (meta.channels !== undefined && meta.channels > 5) {
    throw new WorkerInputError('channels-too-many', 'too many input channels');
  }
  const oriented = orientedDimensions(meta);
  return {
    channels: meta.channels ?? null,
    format,
    hasAlpha: meta.hasAlpha ?? null,
    height: meta.height,
    orientation: meta.orientation ?? null,
    orientedHeight: oriented.height,
    orientedWidth: oriented.width,
    space: meta.space ?? null,
    width: meta.width,
  };
}

function sharpBuffer(bytes) {
  return sharp(bytes, {
    failOn: SHARP_LIMITS.failOn,
    limitInputChannels: SHARP_LIMITS.limitInputChannels,
    limitInputPixels: SHARP_LIMITS.limitInputPixels,
    unlimited: SHARP_LIMITS.unlimited,
  });
}

// Every handler captures its input with a single read and decodes the
// captured buffer — never the path. A file replacement after the verified
// read cannot change the encoded or verified pixels. Production reads are
// capped at MAX_INPUT_BYTES: legitimate inputs (snapshots, frozen copies,
// staged tiers) never exceed it by construction, so anything larger is a
// replaced or grown file that must reject before buffering, never OOM the
// worker. The io seam injects test buffers and keeps its exact behavior.
async function readInputOnce(input, read) {
  if (read) {
    return read(input).catch(() => {
      throw new WorkerInputError('unreadable-input', 'cannot read input file');
    });
  }
  const capped = await readUpToBytes(input, MAX_INPUT_BYTES).catch(() => {
    throw new WorkerInputError('unreadable-input', 'cannot read input file');
  });
  if (capped.truncated) {
    throw new WorkerInputError(
      'input-too-large',
      `input exceeds ${MAX_INPUT_BYTES} bytes`
    );
  }
  return capped.bytes;
}

export async function handleMetadataOp(op, io = {}) {
  const bytes = await readInputOnce(op.input, io.readFile);
  let meta;
  try {
    meta = await sharpBuffer(bytes).metadata();
  } catch (error) {
    throw new WorkerInputError(
      'unreadable-input',
      `cannot decode input metadata (${errorMessage(error)})`
    );
  }
  // Header-level metadata accepts truncated or corrupt pixel payloads, so
  // the probe fully decodes (stats reads every pixel without retaining
  // the buffer) before any caller records the input as acquired. Bounded
  // by the sharp input limits plus the worker op timeout.
  try {
    await sharpBuffer(bytes).stats();
  } catch (error) {
    throw new WorkerInputError(
      'unreadable-input',
      `input does not fully decode (${errorMessage(error)})`
    );
  }
  return { metadata: assertAcceptedMetadata(meta), ok: true };
}

export async function handleEncodeOp(op, io = {}) {
  if (
    typeof op.width !== 'number' ||
    !Number.isInteger(op.width) ||
    op.width < 1 ||
    op.width > MAX_AXIS_PIXELS
  ) {
    throw new WorkerInputError('bad-request', 'invalid encode width');
  }
  if (op.format !== 'avif' && op.format !== 'webp') {
    throw new WorkerInputError('bad-request', 'invalid encode format');
  }
  if (
    typeof op.quality !== 'number' ||
    !Number.isInteger(op.quality) ||
    op.quality < 1 ||
    op.quality > 100
  ) {
    throw new WorkerInputError('bad-request', 'invalid encode quality');
  }
  const inputBytes = await readInputOnce(op.input, io.readFile);
  const inputSha = createHash('sha256').update(inputBytes).digest('hex');
  if (inputSha !== op.expectedInputSha256) {
    throw new WorkerInputError(
      'source-mutated',
      'input bytes changed after validation'
    );
  }
  let meta;
  try {
    meta = await sharpBuffer(inputBytes).metadata();
  } catch (error) {
    throw new WorkerInputError(
      'unreadable-input',
      `cannot decode input metadata (${errorMessage(error)})`
    );
  }
  const accepted = assertAcceptedMetadata(meta);
  const oriented = { height: accepted.orientedHeight, width: accepted.orientedWidth };
  const pipeline = sharpBuffer(inputBytes)
    .rotate()
    .resize({ kernel: sharp.kernel.lanczos3, withoutEnlargement: true, width: op.width })
    .toColorspace('srgb');
  if (op.format === 'avif') {
    pipeline.avif({ effort: ENCODER_OPTIONS.avif.effort, quality: op.quality });
  } else {
    pipeline.webp({ effort: ENCODER_OPTIONS.webp.effort, quality: op.quality });
  }
  try {
    await pipeline.toFile(op.output);
  } catch (error) {
    throw new WorkerInputError(
      'encode-failed',
      `encoding failed (${errorMessage(error)})`
    );
  }
  const info = await stat(op.output);
  // Streamed, never buffered: the output is hashed without loading it
  // whole, so a swapped-in giant hashes in constant memory instead of
  // OOMing the worker before the parent's rung-ceiling comparison.
  const outSha256 = await sha256File(op.output);
  const scale = Math.min(1, op.width / oriented.width);
  return {
    bytes: info.size,
    height: Math.round(oriented.height * scale),
    ok: true,
    output: op.output,
    sha256: outSha256,
    width: Math.min(op.width, oriented.width),
  };
}

export async function handleVerifyOp(op, io = {}) {
  if (op.expectedFormat !== 'avif' && op.expectedFormat !== 'webp') {
    throw new WorkerInputError('bad-request', 'invalid verify format');
  }
  const bytes = await readInputOnce(op.input, io.readFile);
  let meta;
  try {
    await sharpBuffer(bytes).stats();
    meta = await sharpBuffer(bytes).metadata();
  } catch (error) {
    throw new WorkerInputError(
      'verify-failed',
      `output does not fully decode (${errorMessage(error)})`
    );
  }
  const decodedFormat = assertDecodedFormat(meta, op.expectedFormat);
  return {
    bytes: bytes.length,
    format: decodedFormat,
    hasAlpha: meta.hasAlpha ?? false,
    height: meta.height,
    ok: true,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    space: meta.space ?? null,
    width: meta.width,
  };
}

function errorMessage(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
