import assert from 'node:assert/strict';
import {
  chmod,
  link,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readPrivateAuthConfig } from './private-config-file.ts';

test('reads a private bounded regular file without revealing parse errors', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-auth-config-'))
  );
  const path = join(dir, 'config.json');
  try {
    await writeFile(path, '{"synthetic":true}', { mode: 0o600 });
    assert.deepEqual(await readPrivateAuthConfig(path), { synthetic: true });
    await writeFile(path, '{private credential', { mode: 0o600 });
    await assert.rejects(
      readPrivateAuthConfig(path),
      (error: Error) => error.message === 'INVALID_AUTH_CONFIG_FILE'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects readable, linked, oversized and replaceable configuration files', async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-auth-config-'))
  );
  const path = join(dir, 'config.json');
  try {
    await writeFile(path, '{}', { mode: 0o600 });
    await chmod(path, 0o644);
    await assert.rejects(
      readPrivateAuthConfig(path),
      /INVALID_AUTH_CONFIG_FILE/
    );
    await chmod(path, 0o600);
    await symlink(path, join(dir, 'linked.json'));
    await assert.rejects(
      readPrivateAuthConfig(join(dir, 'linked.json')),
      /INVALID_AUTH_CONFIG_FILE/
    );
    await link(path, join(dir, 'hardlink.json'));
    await assert.rejects(
      readPrivateAuthConfig(path),
      /INVALID_AUTH_CONFIG_FILE/
    );
    await rm(join(dir, 'hardlink.json'));
    await writeFile(path, 'x'.repeat(65537));
    await assert.rejects(
      readPrivateAuthConfig(path),
      /INVALID_AUTH_CONFIG_FILE/
    );
    await chmod(dir, 0o777);
    await assert.rejects(
      readPrivateAuthConfig(path),
      /INVALID_AUTH_CONFIG_FILE/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
