import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderPublicOwnerCommand } from './public-owner-command.mjs';

const pins = {
  directory: '/home/bassey/baci-public-checkout-20260928',
  runner: 'a'.repeat(64),
  checksums: 'b'.repeat(64),
  archive: 'c'.repeat(64),
  manifest: 'd'.repeat(64),
};

test('Mac command pins root bootstrap before executing the installed runner', () => {
  const { mac } = renderPublicOwnerCommand(pins);
  assert.match(mac, /ssh -t/);
  assert.match(mac, /sudo \/usr\/bin\/env -i/);
  assert.ok(mac.indexOf(pins.runner) < mac.indexOf('exec /bin/bash'));
  assert.match(mac, /mktemp -d \/root\/baci-public-checkout/);
});

test('root runner verifies the closed bundle before isolated startup or nginx activation', () => {
  const { runner } = renderPublicOwnerCommand(pins);
  assert.ok(
    runner.indexOf('sha256sum -c SHA256SUMS') <
      runner.indexOf('/usr/bin/python3 -I')
  );
  assert.match(runner, /--start --activate-nginx/);
  assert.match(runner, /FIRST_CARD_PUBLIC_STAGING_ACTIVE/);
  assert.doesNotMatch(
    runner,
    /rm -rf|systemctl enable|Paystack staging test secret/
  );
});

test('refuses injectable pins and unapproved source locations', () => {
  for (const input of [
    { ...pins, runner: '$(id)' },
    { ...pins, directory: '/tmp/x' },
    { ...pins, directory: `${pins.directory};id` },
  ]) {
    assert.throws(() => renderPublicOwnerCommand(input));
  }
});

test('the sealed Python file list imports without any source-tree dependency', async () => {
  const { runner } = renderPublicOwnerCommand(pins);
  const files = runner
    .match(/for name in ([^;]+);/)[1]
    .split(' ')
    .filter((name) => name.endsWith('.py'));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'baci-owner-import-'));
  const source = path.dirname(fileURLToPath(import.meta.url));
  try {
    for (const name of files)
      await copyFile(path.join(source, name), path.join(directory, name));
    const result = spawnSync(
      'python3',
      [
        '-I',
        '-c',
        "import runpy,sys; sys.dont_write_bytecode=True; sys.path.insert(0,sys.argv[1]); runpy.run_path(sys.argv[1]+'/public-install-owner.py',run_name='bundle_import_check')",
        directory,
      ],
      { encoding: 'utf8', timeout: 10000, cwd: directory }
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
