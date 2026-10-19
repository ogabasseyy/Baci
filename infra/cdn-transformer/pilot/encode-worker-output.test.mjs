import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  handleEncodeOp,
  handleMetadataOp,
  handleVerifyOp,
} from './encode-worker.mjs';
import { verifyEncodeOutput } from './encode-worker-output.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const workerPath = join(here, 'encode-worker-main.mjs');
const fixture = (name) => join(here, 'fixtures', name);

test('encode certifies the in-memory bytes, not later path content', async () => {
  // A replacement installed after the identity verify must not become
  // the certified result: the injected verify overwrites the file
  // in place (same inode, same length — the real identity check still
  // passes) before delegating, so only memory-derived size/hash keeps
  // Sharp's bytes certified.
  const inputBytes = await readFile(fixture('tiny-48x48.png'));
  const expectedInputSha256 = createHash('sha256')
    .update(inputBytes)
    .digest('hex');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-encode-race-'));
  const output = join(dir, 'out.webp');
  let sharpBytes = null;
  const io = {
    async verifyEncodeOutput(path, claim) {
      sharpBytes = await readFile(path);
      const handle = await open(path, 'r+');
      try {
        await handle.writeFile(Buffer.alloc(sharpBytes.length, 0x61));
      } finally {
        await handle.close();
      }
      await verifyEncodeOutput(path, claim);
    },
  };
  const encoded = await handleEncodeOp(
    {
      expectedInputSha256,
      format: 'webp',
      input: fixture('tiny-48x48.png'),
      maxBytes: 1_000_000,
      op: 'encode',
      output,
      quality: 70,
      width: 96,
    },
    io
  );
  assert.equal(encoded.ok, true);
  assert.equal(encoded.bytes, sharpBytes.length);
  assert.equal(
    encoded.sha256,
    createHash('sha256').update(sharpBytes).digest('hex')
  );
  // Sanity: the path really was swapped under the certification, so a
  // path re-read would have certified the planted bytes instead.
  const planted = await readFile(output);
  assert.notEqual(
    encoded.sha256,
    createHash('sha256').update(planted).digest('hex')
  );
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

test('worker input reads reject past MAX_INPUT_BYTES before buffering', async () => {
  const { MAX_INPUT_BYTES } = await import('./constants.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'pilot-enc-'));
  const codeIs = (code) => (error) => {
    assert.equal(error?.code, code);
    return true;
  };
  // One byte past the ceiling: the size gate trips, not the decoder.
  const giant = join(dir, 'giant.bin');
  await writeFile(giant, Buffer.alloc(MAX_INPUT_BYTES + 1, 0));
  await assert.rejects(() => handleMetadataOp({ input: giant }), codeIs('input-too-large'));
  // Exactly at the ceiling: the size gate passes and the undecodable
  // zeros fail later, at the decoder — proving the boundary.
  const edge = join(dir, 'edge.bin');
  await writeFile(edge, Buffer.alloc(MAX_INPUT_BYTES, 0));
  await assert.rejects(() => handleMetadataOp({ input: edge }), codeIs('unreadable-input'));
});

test('encode refuses a symlinked output without touching its target', async () => {
  const { lstat, symlink } = await import('node:fs/promises');
  const verifiedBytes = await readFile(fixture('tiny-48x48.png'));
  const expectedInputSha256 = createHash('sha256')
    .update(verifiedBytes)
    .digest('hex');
  const io = { readFile: async () => verifiedBytes };
  const dir = await mkdtemp(join(tmpdir(), 'pilot-enc-link-'));
  const outside = join(dir, 'outside.txt');
  await writeFile(outside, 'precious');
  const output = join(dir, 'out.webp');
  await symlink(outside, output);
  const codeIs = (code) => (error) => {
    assert.equal(error?.code, code);
    return true;
  };
  await assert.rejects(
    () =>
      handleEncodeOp(
        {
          expectedInputSha256,
          format: 'webp',
          input: fixture('tiny-48x48.png'),
          op: 'encode',
          maxBytes: 1_000_000,
          output,
          quality: 70,
          width: 96,
        },
        io
      ),
    codeIs('output-unsafe')
  );
  // The link was never followed: the outside target keeps its bytes.
  assert.equal(await readFile(outside, 'utf8'), 'precious');
  assert.equal((await lstat(output)).isSymbolicLink(), true);
  // A dangling plant refuses before 'wx' can create its outside target.
  const dangling = join(dir, 'dangling.webp');
  const nowhere = join(dir, 'nowhere.txt');
  await symlink(nowhere, dangling);
  await assert.rejects(
    () =>
      handleEncodeOp(
        {
          expectedInputSha256,
          format: 'webp',
          input: fixture('tiny-48x48.png'),
          op: 'encode',
          maxBytes: 1_000_000,
          output: dangling,
          quality: 70,
          width: 96,
        },
        io
      ),
    codeIs('output-unsafe')
  );
  await assert.rejects(() => lstat(nowhere), /ENOENT/);
});

test('encode reclaims a stale regular output and certifies the fresh bytes', async () => {
  const verifiedBytes = await readFile(fixture('tiny-48x48.png'));
  const expectedInputSha256 = createHash('sha256')
    .update(verifiedBytes)
    .digest('hex');
  const io = { readFile: async () => verifiedBytes };
  const dir = await mkdtemp(join(tmpdir(), 'pilot-enc-stale-'));
  const output = join(dir, 'out.webp');
  await writeFile(output, 'stale-partial');
  const encoded = await handleEncodeOp(
    {
      expectedInputSha256,
      format: 'webp',
      input: fixture('tiny-48x48.png'),
      op: 'encode',
      maxBytes: 1_000_000,
      output,
      quality: 70,
      width: 96,
    },
    io
  );
  assert.equal(encoded.ok, true);
  assert.equal(encoded.width, 48);
  // The certified hash names the bytes published through the held
  // descriptor — not a pathname reopen a swap could redirect.
  const published = await readFile(output);
  assert.equal(
    createHash('sha256').update(published).digest('hex'),
    encoded.sha256
  );
  assert.equal(published.length, encoded.bytes);
});

test('encode rejects past maxBytes before writing, leaving no file', async () => {
  const { lstat } = await import('node:fs/promises');
  const verifiedBytes = await readFile(fixture('tiny-48x48.png'));
  const expectedInputSha256 = createHash('sha256')
    .update(verifiedBytes)
    .digest('hex');
  const io = { readFile: async () => verifiedBytes };
  const dir = await mkdtemp(join(tmpdir(), 'pilot-enc-cap-'));
  const output = join(dir, 'out.webp');
  // 10 bytes: far below any real webp encoding, so the in-memory
  // result must reject without the worker writing a byte.
  const rejected = await handleEncodeOp(
    {
      expectedInputSha256,
      format: 'webp',
      input: fixture('tiny-48x48.png'),
      maxBytes: 10,
      op: 'encode',
      output,
      quality: 70,
      width: 96,
    },
    io
  );
  assert.equal(rejected.ok, true);
  assert.equal(rejected.status, 'over-budget');
  assert.ok(rejected.bytes > 10);
  // Not even the empty claim remains: the staging dir holds nothing
  // against the reservation.
  await assert.rejects(() => lstat(output), /ENOENT/);
  // A missing or malformed cap refuses loudly — never uncapped.
  for (const maxBytes of [undefined, -1, 1.5, '100']) {
    await assert.rejects(
      () =>
        handleEncodeOp(
          {
            expectedInputSha256,
            format: 'webp',
            input: fixture('tiny-48x48.png'),
            maxBytes,
            op: 'encode',
            output: join(dir, `bad-${String(maxBytes)}.webp`),
            quality: 70,
            width: 96,
          },
          io
        ),
      (error) => {
        assert.equal(error?.code, 'bad-request');
        return true;
      }
    );
  }
});
