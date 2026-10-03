// Killable single-operation Sharp worker. The parent (encoder.mjs) spawns one
// process per native operation with a JSON op in argv[2]; the worker prints a
// single JSON result to stdout. Handled outcomes (including input rejections)
// exit 0 with { ok: true|false }; protocol misuse or unexpected crashes exit
// non-zero so the parent can distinguish rejection from worker failure.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  ACCEPTED_INPUT_FORMATS,
  ENCODER_OPTIONS,
  MAX_AXIS_PIXELS,
  MAX_DECODED_PIXELS,
  SHARP_LIMITS,
} from './constants.mjs';

export class WorkerInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'WorkerInputError';
  }
}

// Sharp/libvips reports the shared HEIF container as `heif` for both input
// and output bytes. Only AV1-coded stills are AVIF: HEVC-coded HEIC stills
// and unknown compressions stay `heif` so the format gates reject them.
export function normalizeFormat(meta) {
  if (meta?.format === 'heif' && meta?.compression === 'av1') {
    return 'avif';
  }
  return meta?.format;
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

export function orientedDimensions(meta) {
  const orientation = meta.orientation ?? 1;
  if (orientation >= 5 && orientation <= 8) {
    return { height: meta.width, width: meta.height };
  }
  return { height: meta.height, width: meta.width };
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
// read cannot change the encoded or verified pixels.
async function readInputOnce(input, read) {
  return read(input).catch(() => {
    throw new WorkerInputError('unreadable-input', 'cannot read input file');
  });
}

export async function handleMetadataOp(op, io = {}) {
  const read = io.readFile ?? readFile;
  const bytes = await readInputOnce(op.input, read);
  let meta;
  try {
    meta = await sharpBuffer(bytes).metadata();
  } catch (error) {
    throw new WorkerInputError(
      'unreadable-input',
      `cannot decode input metadata (${errorMessage(error)})`
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
  const inputBytes = await readInputOnce(op.input, io.readFile ?? readFile);
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
  const outBytes = await readFile(op.output);
  const scale = Math.min(1, op.width / oriented.width);
  return {
    bytes: info.size,
    height: Math.round(oriented.height * scale),
    ok: true,
    output: op.output,
    sha256: createHash('sha256').update(outBytes).digest('hex'),
    width: Math.min(op.width, oriented.width),
  };
}

export async function handleVerifyOp(op, io = {}) {
  if (op.expectedFormat !== 'avif' && op.expectedFormat !== 'webp') {
    throw new WorkerInputError('bad-request', 'invalid verify format');
  }
  const bytes = await readInputOnce(op.input, io.readFile ?? readFile);
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

function parseOp(raw) {
  if (!raw) {
    throw new WorkerInputError('bad-request', 'missing op JSON');
  }
  let op;
  try {
    op = JSON.parse(raw);
  } catch {
    throw new WorkerInputError('bad-request', 'op is not valid JSON');
  }
  if (!op || typeof op !== 'object' || typeof op.input !== 'string') {
    throw new WorkerInputError('bad-request', 'op requires an input path');
  }
  if (op.op !== 'metadata' && op.op !== 'encode' && op.op !== 'verify') {
    throw new WorkerInputError('bad-request', `unknown op "${op?.op}"`);
  }
  if (op.op === 'encode' && typeof op.output !== 'string') {
    throw new WorkerInputError('bad-request', 'encode requires an output path');
  }
  return op;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    let op;
    try {
      op = parseOp(process.argv[2]);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 2;
      return;
    }
    try {
      const result =
        op.op === 'metadata'
          ? await handleMetadataOp(op)
          : op.op === 'encode'
            ? await handleEncodeOp(op)
            : await handleVerifyOp(op);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      if (error instanceof WorkerInputError) {
        process.stdout.write(
          `${JSON.stringify({ code: error.code, message: error.message, ok: false })}\n`
        );
        return;
      }
      console.error(errorMessage(error));
      process.exitCode = 1;
    }
  })();
}
