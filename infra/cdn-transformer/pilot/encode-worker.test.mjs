import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  assertAcceptedMetadata,
  assertDecodedFormat,
  handleEncodeOp,
  handleMetadataOp,
  handleVerifyOp,
  normalizeFormat,
  orientedDimensions,
} from './encode-worker.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const workerPath = join(here, 'encode-worker.mjs');
const fixture = (name) => join(here, 'fixtures', name);

async function runWorker(op) {
  const { stdout } = await run(process.execPath, [workerPath, JSON.stringify(op)], {
    timeout: 30_000,
  });
  return JSON.parse(stdout);
}

test('orientedDimensions swaps only for rotated EXIF orientations', () => {
  assert.deepEqual(orientedDimensions({ height: 800, width: 600 }), {
    height: 800,
    width: 600,
  });
  assert.deepEqual(
    orientedDimensions({ height: 800, orientation: 1, width: 600 }),
    { height: 800, width: 600 }
  );
  assert.deepEqual(
    orientedDimensions({ height: 800, orientation: 6, width: 600 }),
    { height: 600, width: 800 }
  );
  assert.deepEqual(
    orientedDimensions({ height: 800, orientation: 8, width: 600 }),
    { height: 600, width: 800 }
  );
});

test('assertAcceptedMetadata accepts ordinary still images', () => {
  const accepted = assertAcceptedMetadata({
    channels: 3,
    format: 'jpeg',
    height: 1254,
    width: 1254,
  });
  assert.equal(accepted.format, 'jpeg');
});

function rejectionCode(meta) {
  try {
    assertAcceptedMetadata(meta);
  } catch (error) {
    return error.code;
  }
  return null;
}

test('assertAcceptedMetadata rejects unsupported and animated input', () => {
  for (const format of ['svg', 'gif', 'tiff', 'heic', undefined]) {
    assert.equal(
      rejectionCode({ channels: 3, format, height: 64, width: 64 }),
      'unsupported-format',
      String(format)
    );
  }
  // Sharp labels AVIF stills `heif` with AV1 compression; the gate
  // accepts them as static AVIF.
  assert.equal(
    assertAcceptedMetadata({
      channels: 3,
      compression: 'av1',
      format: 'heif',
      height: 64,
      width: 64,
    }).format,
    'avif'
  );
  // HEVC-coded HEIC stills share the `heif` container label but are not
  // AVIF; unknown compressions fail closed too.
  assert.equal(
    rejectionCode({ channels: 3, compression: 'hevc', format: 'heif', height: 64, width: 64 }),
    'unsupported-format'
  );
  assert.equal(
    rejectionCode({ channels: 3, format: 'heif', height: 64, width: 64 }),
    'unsupported-format'
  );
  assert.equal(
    rejectionCode({
      channels: 3,
      format: 'webp',
      height: 64,
      pages: 2,
      width: 64,
    }),
    'animated-input'
  );
  assert.equal(
    rejectionCode({
      channels: 3,
      format: 'avif',
      height: 64,
      pages: 3,
      width: 64,
    }),
    'animated-input'
  );
});

test('normalizeFormat only maps AV1-coded HEIF to AVIF', () => {
  assert.equal(normalizeFormat({ compression: 'av1', format: 'heif' }), 'avif');
  assert.equal(normalizeFormat({ compression: 'hevc', format: 'heif' }), 'heif');
  assert.equal(normalizeFormat({ format: 'heif' }), 'heif');
  assert.equal(normalizeFormat({ format: 'webp' }), 'webp');
});

test('assertDecodedFormat rejects HEVC and unknown compressions as AVIF', () => {
  assert.equal(
    assertDecodedFormat({ compression: 'av1', format: 'heif' }, 'avif'),
    'avif'
  );
  for (const meta of [
    { compression: 'hevc', format: 'heif' },
    { format: 'heif' },
  ]) {
    assert.throws(() => assertDecodedFormat(meta, 'avif'), (error) => {
      assert.equal(error.code, 'verify-failed');
      assert.match(error.message, /expected avif output, decoded heif/);
      return true;
    });
  }
});

test('assertAcceptedMetadata enforces pixel, axis, and channel limits', () => {
  assert.equal(
    rejectionCode({ channels: 3, format: 'jpeg', height: 8000, width: 8000 }),
    'pixels-too-large'
  );
  assert.equal(
    rejectionCode({ channels: 3, format: 'png', height: 10, width: 16_385 }),
    'dimensions-too-large'
  );
  assert.equal(
    rejectionCode({ channels: 6, format: 'png', height: 64, width: 64 }),
    'channels-too-many'
  );
  assert.equal(
    rejectionCode({ channels: 3, format: 'png' }),
    'unreadable-input'
  );
});

test('worker metadata op reports EXIF-corrected geometry', async () => {
  const result = await runWorker({
    input: fixture('exif-rotated-600x800.jpg'),
    op: 'metadata',
  });
  assert.equal(result.ok, true);
  assert.equal(result.metadata.format, 'jpeg');
  assert.equal(result.metadata.width, 600);
  assert.equal(result.metadata.height, 800);
  assert.equal(result.metadata.orientedWidth, 800);
  assert.equal(result.metadata.orientedHeight, 600);
  assert.ok(
    Number.isInteger(result.workerPeakRssBytes) && result.workerPeakRssBytes > 0,
    'ok envelope self-reports worker RSS for job accounting'
  );
});

test('worker metadata op rejects animated and foreign input', async () => {
  const animated = await runWorker({
    input: fixture('anim-2frame.webp'),
    op: 'metadata',
  });
  assert.equal(animated.ok, false);
  assert.equal(animated.code, 'animated-input');

  const svg = await runWorker({
    input: fixture('vector-image.svg'),
    op: 'metadata',
  });
  assert.equal(svg.ok, false);
  assert.equal(svg.code, 'unsupported-format');

  const garbage = await runWorker({
    input: fixture('garbage-not-an-image.bin'),
    op: 'metadata',
  });
  assert.equal(garbage.ok, false);
  assert.equal(garbage.code, 'unreadable-input');

  const avif = await runWorker({
    input: fixture('still-256x256.avif'),
    op: 'metadata',
  });
  assert.equal(avif.ok, true);
  assert.equal(avif.metadata.format, 'avif');
  assert.equal(avif.metadata.orientedWidth, 256);
});

test('handlers use the verified bytes, not later path content', async () => {
  const verifiedBytes = await readFile(fixture('tiny-48x48.png'));
  const swappedPath = fixture('wide-2000x500.png');
  const io = { readFile: async () => verifiedBytes };
  const expectedInputSha256 = createHash('sha256').update(verifiedBytes).digest('hex');

  const metadata = await handleMetadataOp({ input: swappedPath, op: 'metadata' }, io);
  assert.equal(metadata.ok, true);
  assert.equal(metadata.metadata.width, 48);
  assert.equal(metadata.metadata.height, 48);

  const dir = await mkdtemp(join(tmpdir(), 'pilot-race-'));
  const output = join(dir, 'out.webp');
  const encoded = await handleEncodeOp(
    {
      expectedInputSha256,
      format: 'webp',
      input: swappedPath,
      op: 'encode',
      output,
      quality: 70,
      width: 96,
    },
    io
  );
  assert.equal(encoded.ok, true);
  // The 48px verified source is never upscaled, even though the path now
  // holds a 2000px image.
  assert.equal(encoded.width, 48);
  assert.equal(encoded.height, 48);
});

test('verify decodes and hashes one captured snapshot', async () => {
  const verifiedBytes = await sharp(fixture('tiny-48x48.png'))
    .resize({ width: 48 })
    .webp({ effort: 4, quality: 70 })
    .toBuffer();
  const swappedBytes = await sharp(fixture('wide-2000x500.png'))
    .resize({ width: 200 })
    .webp({ effort: 4, quality: 70 })
    .toBuffer();
  const dir = await mkdtemp(join(tmpdir(), 'pilot-verify-race-'));
  const swappedPath = join(dir, 'output.webp');
  await sharp(swappedBytes).toFile(swappedPath);
  const io = { readFile: async () => verifiedBytes };
  const facts = await handleVerifyOp(
    { expectedFormat: 'webp', input: swappedPath, op: 'verify' },
    io
  );
  assert.equal(facts.ok, true);
  assert.equal(facts.width, 48);
  assert.equal(facts.sha256, createHash('sha256').update(verifiedBytes).digest('hex'));
});

test('worker rejects protocol misuse with a non-zero exit', async () => {
  await assert.rejects(() => run(process.execPath, [workerPath], { timeout: 10_000 }));
  await assert.rejects(() =>
    run(process.execPath, [workerPath, '{nope'], { timeout: 10_000 })
  );
  await assert.rejects(() =>
    run(process.execPath, [workerPath, JSON.stringify({ op: 'delete-everything' })], {
      timeout: 10_000,
    })
  );
});
