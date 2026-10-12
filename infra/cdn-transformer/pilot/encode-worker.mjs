// Killable single-operation Sharp worker: the op handlers. The parent
// (encoder.mjs) spawns one process per native operation via
// encode-worker-main.mjs with a JSON op in argv[2]; the worker prints a
// single JSON result to stdout. Handled outcomes (including input rejections)
// exit 0 with { ok: true|false }; protocol misuse or unexpected crashes exit
// non-zero so the parent can distinguish rejection from worker failure.
import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import sharp from 'sharp';
import {
  ACCEPTED_INPUT_FORMATS,
  ENCODER_OPTIONS,
  MAX_AXIS_PIXELS,
  MAX_DECODED_PIXELS,
  MAX_ENCODED_BYTES,
} from './constants.mjs';
import {
  normalizeFormat,
  orientedDimensions,
} from './encode-worker-formats.mjs';
import {
  errorMessage,
  readInputOnce,
  sharpBuffer,
} from './encode-worker-input.mjs';
import {
  claimEncodeOutput,
  verifyEncodeOutput,
  WorkerInputError,
} from './encode-worker-output.mjs';

export { errorMessage, normalizeFormat, orientedDimensions, WorkerInputError };

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
  // Per-attempt byte cap from the parent (rung ceiling within remaining
  // staging headroom): the worker must reject the in-memory result
  // before writing it, so an incompressible encode never lands up to
  // MAX_ENCODED_BYTES on disk against a smaller reservation. Missing
  // or malformed caps refuse loudly — an uncapped write is the hole.
  if (
    typeof op.maxBytes !== 'number' ||
    !Number.isInteger(op.maxBytes) ||
    op.maxBytes < 0
  ) {
    throw new WorkerInputError('bad-request', 'invalid encode maxBytes');
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
  // Publish through the held claim: Sharp encodes to memory and the
  // bytes go out through the exclusively created descriptor, so the
  // predictable pathname is never reopened and no rename+symlink swap
  // can redirect the write outside the staging tree.
  const claim = await claimEncodeOutput(op.output, op.stagingRoot);
  let encodedBytes = null;
  let overBudgetBytes = null;
  try {
    const bytes = await pipeline.toBuffer();
    if (bytes.length > MAX_ENCODED_BYTES) {
      throw new WorkerInputError(
        'encode-failed',
        'encoded output exceeds the byte budget'
      );
    }
    if (bytes.length > op.maxBytes) {
      // Rejected BEFORE the write: nothing lands on disk against the
      // smaller reservation, so the staging cap holds even while the
      // parent's post-write comparison still runs as defense in depth.
      overBudgetBytes = bytes.length;
    } else {
      await claim.handle.writeFile(bytes);
      await claim.handle.sync();
      encodedBytes = bytes;
    }
  } catch (error) {
    if (error instanceof WorkerInputError) {
      throw error;
    }
    throw new WorkerInputError(
      'encode-failed',
      `encoding failed (${errorMessage(error)})`
    );
  } finally {
    await claim.handle.close();
  }
  if (overBudgetBytes !== null) {
    // Remove the empty claim: unlink never follows a trailing symlink,
    // so a swap between the close and now only deletes the planted
    // name. A removal failure is fatal — retained bytes outside the
    // staging cap must never pass silently.
    try {
      await unlink(op.output);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new WorkerInputError(
          'encode-failed',
          `over-budget claim could not be removed (${error?.code ?? 'unknown'})`
        );
      }
    }
    return {
      bytes: overBudgetBytes,
      ok: true,
      output: op.output,
      status: 'over-budget',
    };
  }
  // The path identity check still fails closed on a rename swap, but
  // the certified size/hash come from the in-memory buffer Sharp
  // produced — never from a post-close path re-read. A replacement
  // installed after this verify would otherwise be stat/hashed as the
  // encode result and committed downstream; the parent's fresh
  // decode-verify comparison plus the staging byte assertion catch any
  // on-disk divergence from these memory-certified facts instead.
  const verifyOutput = io.verifyEncodeOutput ?? verifyEncodeOutput;
  await verifyOutput(op.output, claim);
  const outSha256 = createHash('sha256').update(encodedBytes).digest('hex');
  const scale = Math.min(1, op.width / oriented.width);
  return {
    bytes: encodedBytes.length,
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
