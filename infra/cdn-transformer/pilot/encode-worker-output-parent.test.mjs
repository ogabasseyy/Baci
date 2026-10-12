import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { handleEncodeOp } from './encode-worker.mjs';
import {
  claimEncodeOutput,
  verifyEncodeOutput,
} from './encode-worker-output.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);

const codeIs = (code) => (error) => {
  assert.equal(error?.code, code);
  return true;
};

async function encodeInput() {
  const verifiedBytes = await readFile(fixture('tiny-48x48.png'));
  return {
    expectedInputSha256: createHash('sha256')
      .update(verifiedBytes)
      .digest('hex'),
    io: { readFile: async () => verifiedBytes },
  };
}

test('encode refuses a staging dir swapped for a link before the claim', async () => {
  // The run token is visible in the shared claim, so the staging path
  // is predictable: a contender renames it away and plants a link. The
  // claim must refuse against the expected root instead of creating
  // the encoded file outside the tree.
  const { expectedInputSha256, io } = await encodeInput();
  const dir = await mkdtemp(join(tmpdir(), 'pilot-enc-parentswap-'));
  const staging = join(dir, 'staging-abc123');
  await mkdir(staging, { recursive: true });
  const outside = join(dir, 'outside');
  await mkdir(outside, { recursive: true });
  await rename(staging, join(dir, 'staging-moved'));
  await symlink(outside, staging);
  await assert.rejects(
    () =>
      handleEncodeOp(
        {
          expectedInputSha256,
          format: 'webp',
          input: fixture('tiny-48x48.png'),
          maxBytes: 1_000_000,
          op: 'encode',
          output: join(staging, 'stem-w96-q70.webp'),
          quality: 70,
          stagingRoot: join(dir, 'staging-moved'),
          width: 96,
        },
        io
      ),
    codeIs('output-unsafe')
  );
  assert.deepEqual(await readdir(outside), []);
});

test('encode refuses a nested parent link under an intact root', async () => {
  // Same attack one level down: the staging root itself is untouched,
  // but the output's parent resolves outside it.
  const { expectedInputSha256, io } = await encodeInput();
  const dir = await mkdtemp(join(tmpdir(), 'pilot-enc-nestedlink-'));
  const staging = join(dir, 'staging-abc123');
  await mkdir(staging, { recursive: true });
  const outside = join(dir, 'outside');
  await mkdir(outside, { recursive: true });
  await symlink(outside, join(staging, 'sub'));
  await assert.rejects(
    () =>
      handleEncodeOp(
        {
          expectedInputSha256,
          format: 'webp',
          input: fixture('tiny-48x48.png'),
          maxBytes: 1_000_000,
          op: 'encode',
          output: join(staging, 'sub', 'stem-w96-q70.webp'),
          quality: 70,
          stagingRoot: staging,
          width: 96,
        },
        io
      ),
    /escapes the staging root/
  );
  assert.deepEqual(await readdir(outside), []);
});

test('encode verify rejects a parent swapped between claim and verify', async () => {
  // The dev/ino check traverses the substituted parent and sees the
  // same inode, so only the pinned canonical parent exposes the swap.
  const dir = await mkdtemp(join(tmpdir(), 'pilot-enc-verifyparent-'));
  const staging = join(dir, 'staging-abc123');
  await mkdir(staging, { recursive: true });
  const outside = join(dir, 'outside');
  await mkdir(outside, { recursive: true });
  const output = join(staging, 'stem-w96-q70.webp');
  const claim = await claimEncodeOutput(output, staging);
  try {
    await claim.handle.writeFile(Buffer.from('encoded'));
  } finally {
    await claim.handle.close();
  }
  // Undisturbed pinned claims still verify.
  await verifyEncodeOutput(output, claim);
  await rename(staging, join(dir, 'staging-moved'));
  await symlink(outside, staging);
  // The parent gate fires first (lstat is never reached), so the
  // message proves the pinned parent — not the identity check —
  // exposed the swap.
  await assert.rejects(
    () => verifyEncodeOutput(output, claim),
    /parent changed during the write/
  );
});
