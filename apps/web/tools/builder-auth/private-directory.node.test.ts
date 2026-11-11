import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertPrivateDirectory } from './private-directory.ts';

test('accepts an owned private directory and rejects public or symlinked paths', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-private-dir-'))
  );
  const link = `${dir}-link`;
  try {
    await assertPrivateDirectory(dir);
    await symlink(dir, link);
    await assert.rejects(
      assertPrivateDirectory(link),
      /UNTRUSTED_SOCKET_DIRECTORY/
    );
    await chmod(dir, 0o755);
    await assert.rejects(
      assertPrivateDirectory(dir),
      /UNTRUSTED_SOCKET_DIRECTORY/
    );
  } finally {
    await rm(link, { force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
