// Killable-worker input plumbing: Sharp instancing under the generator
// limits, single verified reads, and bounded error rendering. Split from
// encode-worker.mjs under the repo line ceiling.
import sharp from 'sharp';
import { MAX_INPUT_BYTES, SHARP_LIMITS } from './constants.mjs';
import { readUpToBytes } from './disk-guards.mjs';
import { WorkerInputError } from './encode-worker-output.mjs';

export function sharpBuffer(bytes) {
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
export async function readInputOnce(input, read) {
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

export function errorMessage(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
