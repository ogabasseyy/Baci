import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { authenticatedTreeRows } from './source-manifest-tree.mjs';

test('keeps cross-component raw-name identities distinct', () => {
  const root = mkdtempSync(
    join(tmpdir(), 'source-manifest-tree-raw-components-')
  );
  try {
    execFileSync('/usr/bin/git', ['init', '-q', root]);
    const blob = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'hash-object', '-w', '--stdin'],
      { input: Buffer.from('blob\n') }
    )
      .toString()
      .trim();
    const tree = (name) =>
      execFileSync(
        '/usr/bin/git',
        [
          '-C',
          root,
          'hash-object',
          '--literally',
          '-t',
          'tree',
          '-w',
          '--stdin',
        ],
        {
          input: Buffer.concat([
            Buffer.from('100644 '),
            Buffer.from(name),
            Buffer.from([0]),
            Buffer.from(blob, 'hex'),
          ]),
        }
      )
        .toString()
        .trim();
    const rawLeafTree = tree('~gitraw-626164ff', blob);
    const validLeafTree = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'hash-object', '--literally', '-t', 'tree', '-w', '--stdin'],
      {
        input: Buffer.concat([
          Buffer.from('100644 '),
          Buffer.from('bad'),
          Buffer.from([0xff]),
          Buffer.from([0]),
          Buffer.from(blob, 'hex'),
        ]),
      }
    )
      .toString()
      .trim();
    const rootTree = execFileSync(
      '/usr/bin/git',
      ['-C', root, 'hash-object', '--literally', '-t', 'tree', '-w', '--stdin'],
      {
        input: Buffer.concat([
          Buffer.from('40000 bad'),
          Buffer.from([0xff]),
          Buffer.from([0]),
          Buffer.from(rawLeafTree, 'hex'),
          Buffer.from('40000 ~gitraw-626164ff\0'),
          Buffer.from(validLeafTree, 'hex'),
        ]),
      }
    )
      .toString()
      .trim();
    const commit = execFileSync(
      '/usr/bin/git',
      [
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@invalid',
        '-C',
        root,
        'commit-tree',
        rootTree,
      ],
      {
        input:
          'author test <test@invalid> 0 +0000\ncommitter test <test@invalid> 0 +0000\n\nraw-components\n',
      }
    )
      .toString()
      .trim();
    assert.equal(authenticatedTreeRows(root, commit).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
