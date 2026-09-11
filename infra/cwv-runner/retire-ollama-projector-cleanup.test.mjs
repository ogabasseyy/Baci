import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-projector-auth.sh', import.meta.url);

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'baci-projector-cleanup-'));
  const statBin = join(base, 'bin');
  await mkdir(statBin);
  await writeFile(
    join(statBin, 'stat'),
    `#!${process.execPath}
const fs = require('node:fs');
const s = fs.lstatSync(process.argv.at(-1));
process.stdout.write(String(s.dev) + ':' + String(s.ino) + '\\n');
`,
    { mode: 0o755 }
  );
  const path = join(base, 'baci-projector-auth.fixture');
  await mkdir(path);
  await writeFile(join(path, 'owned'), 'owned');
  const identity = await lstat(path);
  return { base, identity: `${identity.dev}:${identity.ino}`, path, statBin };
}

async function cleanupWithIdentity({
  base,
  identity,
  path,
  statBin,
  strict = false,
}) {
  const script =
    `${strict ? 'set -u; ' : ''}. "$1"; running_projector_uid=1; RETIRE_OLLAMA_TEST_BIN="$5"; ` +
    'running_projector_snapshot_base="$2"; running_projector_snapshot_dir="$3"; ' +
    'running_projector_snapshot_identity="$4"; running_container_projector_snapshot_cleanup';
  await execFileAsync('sh', [
    '-c',
    script,
    'sh',
    helper.pathname,
    base,
    path,
    identity,
    statBin,
  ]);
}

async function cleanupWithPostMoveStatFailure(value) {
  const statBin = join(value.base, 'post-move-failure-bin');
  await mkdir(statBin);
  await writeFile(
    join(statBin, 'stat'),
    `#!${process.execPath}
const fs = require('node:fs');
const target = process.argv.at(-1);
if (target.includes('.cleanup.')) {
  fs.rmSync(target, { force: true, recursive: true });
  fs.mkdirSync(target);
  fs.writeFileSync(target + '/attacker', 'attacker');
  process.exit(1);
}
const s = fs.lstatSync(target);
process.stdout.write(String(s.dev) + ':' + String(s.ino) + '\\n');
`,
    { mode: 0o755 }
  );
  await cleanupWithIdentity({ ...value, statBin });
}

async function cleanupTwiceWithPostMoveStatFailure(first, second) {
  const statBin = join(first.base, 'sequence-bin');
  await mkdir(statBin);
  await writeFile(
    join(statBin, 'stat'),
    `#!${process.execPath}
const fs = require('node:fs');
const target = process.argv.at(-1);
if (target.includes('.cleanup.')) process.exit(1);
const s = fs.lstatSync(target);
process.stdout.write(String(s.dev) + ':' + String(s.ino) + '\\n');
`,
    { mode: 0o755 }
  );
  const script =
    '. "$1"; running_projector_uid=1; RETIRE_OLLAMA_TEST_BIN="$7"; ' +
    'running_projector_snapshot_base="$2"; running_projector_snapshot_dir="$3"; ' +
    'running_projector_snapshot_identity="$4"; running_container_projector_snapshot_cleanup; ' +
    'first="$running_projector_cleanup_quarantine"; running_projector_snapshot_base="$5"; ' +
    'running_projector_snapshot_dir="$6"; running_projector_snapshot_identity="$8"; ' +
    'running_container_projector_snapshot_cleanup; printf "%s\\n%s\\n" "$first" "$running_projector_cleanup_quarantine"';
  const { stdout } = await execFileAsync('sh', [
    '-c',
    script,
    'sh',
    helper.pathname,
    first.base,
    first.path,
    first.identity,
    second.base,
    second.path,
    statBin,
    second.identity,
  ]);
  return stdout.trim().split('\n');
}

test('installs cleanup trap before snapshot identity stat', async () => {
  const source = await readFile(helper, 'utf8');
  const mktemp = source.indexOf(
    'running_projector_snapshot_dir=$(/usr/bin/mktemp -d'
  );
  const trap = source.indexOf(
    'trap running_container_projector_snapshot_cleanup EXIT HUP INT TERM'
  );
  const identity = source.indexOf(
    'running_projector_snapshot_identity=$(running_container_projector_stat'
  );
  assert.ok(mktemp >= 0 && trap > mktemp && identity > trap);
});

test('does not delete a replacement snapshot with a stale identity', async () => {
  const value = await fixture();
  try {
    // Keep the recorded directory allocated while creating the replacement;
    // this makes the identity-difference assertion deterministic.
    await rename(value.path, `${value.path}.original`);
    await mkdir(value.path);
    await writeFile(join(value.path, 'attacker'), 'attacker');
    const replacement = await lstat(value.path);
    assert.notEqual(
      `${replacement.dev}:${replacement.ino}`,
      value.identity,
      'replacement must not retain the recorded snapshot identity'
    );
    await cleanupWithIdentity(value);
    assert.equal(
      await readFile(join(value.path, 'attacker'), 'utf8'),
      'attacker'
    );
  } finally {
    await rm(value.base, { recursive: true, force: true });
  }
});

test('quarantines and removes the recorded snapshot identity', async () => {
  const value = await fixture();
  try {
    await cleanupWithIdentity(value);
    await assert.rejects(lstat(value.path), { code: 'ENOENT' });
  } finally {
    await rm(value.base, { recursive: true, force: true });
  }
});

test('initializes the cleanup sequence under set -u', async () => {
  const value = await fixture();
  try {
    await cleanupWithIdentity({ ...value, strict: true });
    await assert.rejects(lstat(value.path), { code: 'ENOENT' });
  } finally {
    await rm(value.base, { recursive: true, force: true });
  }
});

test('does not remove an unverified replacement after quarantine validation fails', async () => {
  const value = await fixture();
  try {
    await cleanupWithPostMoveStatFailure(value);
    const names = await readdir(value.base);
    const quarantine = names.find((name) =>
      name.startsWith('baci-projector-auth.fixture.cleanup.')
    );
    assert.ok(quarantine, 'post-move replacement should remain quarantined');
    let attacker;
    try {
      attacker = await readFile(
        join(value.base, quarantine, 'attacker'),
        'utf8'
      );
    } catch {
      attacker = await readFile(
        join(value.base, quarantine, 'payload', 'attacker'),
        'utf8'
      );
    }
    assert.equal(attacker, 'attacker');
  } finally {
    await rm(value.base, { recursive: true, force: true });
  }
});

test('uses distinct quarantine names for repeated cleanup in one process', async () => {
  const first = await fixture();
  const second = await fixture();
  try {
    const quarantinePaths = await cleanupTwiceWithPostMoveStatFailure(
      first,
      second
    );
    assert.equal(quarantinePaths.length, 2);
    assert.notEqual(
      quarantinePaths[0].slice(quarantinePaths[0].lastIndexOf('.cleanup.')),
      quarantinePaths[1].slice(quarantinePaths[1].lastIndexOf('.cleanup.'))
    );
    assert.equal(
      (await readdir(first.base)).some((name) => name.includes('.cleanup.')),
      true
    );
    assert.equal(
      (await readdir(second.base)).some((name) => name.includes('.cleanup.')),
      true
    );
  } finally {
    await rm(first.base, { recursive: true, force: true });
    await rm(second.base, { recursive: true, force: true });
  }
});

test('does not let a predictable cleanup sibling block quarantine', async () => {
  const value = await fixture();
  const script =
    '. "$1"; running_projector_uid=1; RETIRE_OLLAMA_TEST_BIN="$5"; ' +
    'running_projector_snapshot_base="$2"; running_projector_snapshot_dir="$3"; ' +
    'running_projector_snapshot_identity="$4"; decoy="$3.cleanup.$$"; ' +
    'mkdir "$decoy"; running_container_projector_snapshot_cleanup; ' +
    '[ ! -e "$3" ] && [ -d "$decoy" ] && printf "%s\\n" "$decoy"';
  try {
    const { stdout } = await execFileAsync('sh', [
      '-c',
      script,
      'sh',
      helper.pathname,
      value.base,
      value.path,
      value.identity,
      value.statBin,
    ]);
    await assert.rejects(lstat(value.path), { code: 'ENOENT' });
    await assert.doesNotReject(lstat(stdout.trim()));
  } finally {
    await rm(value.base, { recursive: true, force: true });
  }
});
