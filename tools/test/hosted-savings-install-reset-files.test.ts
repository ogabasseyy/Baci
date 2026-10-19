import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyHostedSavingsResetFile } from './hosted-savings-install-reset-files';

test('verifies synthetic private bytes and rejects hash, size, permissions and path violations', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'reset-file-test-')));
  const path = join(directory, 'synthetic');
  const contents = 'synthetic fixture only';
  const expected = { path, bytes: Buffer.byteLength(contents), sha256: createHash('sha256').update(contents).digest('hex') };
  try {
    await writeFile(path, contents, { mode: 0o600 });
    await verifyHostedSavingsResetFile(expected);
    await assert.rejects(verifyHostedSavingsResetFile({ ...expected, bytes: expected.bytes + 1 }), /size mismatch/);
    await assert.rejects(verifyHostedSavingsResetFile({ ...expected, sha256: '0'.repeat(64) }), /hash or stability/);
    await chmod(path, 0o640);
    await assert.rejects(verifyHostedSavingsResetFile(expected), /private regular/);
    await chmod(path, 0o600);
    const link = join(directory, 'link');
    await symlink(path, link);
    await assert.rejects(verifyHostedSavingsResetFile({ ...expected, path: link }), /private regular/);
    await assert.rejects(verifyHostedSavingsResetFile({ ...expected, path: directory }), /private regular/);
    await assert.rejects(verifyHostedSavingsResetFile({ ...expected, path: `${directory}/./synthetic` }), /private regular/);
    await assert.rejects(verifyHostedSavingsResetFile({ ...expected, path: join(directory, 'missing') }), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
