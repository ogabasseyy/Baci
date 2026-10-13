import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyTask9NodeArchive } from './task9-node-archive.mjs';

const sha = (bytes) =>
  execFileSync('shasum', ['-a', '256'], {
    input: bytes,
    encoding: 'utf8',
  }).split(' ')[0];

function archiveFixture() {
  const root = mkdtempSync(join(tmpdir(), 'task9-node-archive-'));
  const tree = join(root, 'node-v24.18.0-darwin-arm64');
  mkdirSync(join(tree, 'bin'), { recursive: true });
  const node = Buffer.from('signed archive executable');
  writeFileSync(join(tree, 'bin/node'), node, { mode: 0o500 });
  const archive = join(root, 'node.tar.xz');
  execFileSync('/usr/bin/tar', [
    '-cJf',
    archive,
    '-C',
    root,
    'node-v24.18.0-darwin-arm64',
  ]);
  return { archive: readFileSync(archive), node, root };
}

test('binds prepared Node bytes to the policy-hashed archive member', () => {
  const fixture = archiveFixture();
  try {
    verifyTask9NodeArchive({
      archiveBytes: fixture.archive,
      nodeBytes: fixture.node,
      archiveSha256: sha(fixture.archive),
      version: '24.18.0',
    });
    assert.throws(
      () =>
        verifyTask9NodeArchive({
          archiveBytes: fixture.archive,
          nodeBytes: Buffer.from('caller replacement'),
          archiveSha256: sha(fixture.archive),
          version: '24.18.0',
        }),
      /invalid Node archive/
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('rejects archive bytes whose digest is not the reviewed policy digest', () => {
  const fixture = archiveFixture();
  try {
    assert.throws(
      () =>
        verifyTask9NodeArchive({
          archiveBytes: fixture.archive,
          nodeBytes: fixture.node,
          archiveSha256: '0'.repeat(64),
          version: '24.18.0',
        }),
      /invalid Node archive/
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});
