import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = resolve('.github/scripts/android-disk-preflight.sh');

async function fixture(t, available = '100') {
  const root = await mkdtemp(join(tmpdir(), 'baci disk gate '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const first = join(root, 'workspace path');
  const second = join(root, 'gradle path');
  await Promise.all([mkdir(bin), mkdir(first), mkdir(second)]);
  await writeFile(join(bin, 'df'), `#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'\nprintf '/dev/test 1000 1 ${available} 1%% /mount with spaces\\n'\n`);
  await chmod(join(bin, 'df'), 0o755);
  function run(args) {
    return spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
  }
  return { root, first, second, run };
}

test('checks a shared filesystem once and sums its budgets', async (t) => {
  const { first, second, run } = await fixture(t);
  const result = run(['50000', 'workspace', first, '40000', 'gradle', second]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /available=102400 bytes/);
  assert.match(result.stdout, /required=90000 bytes/);
  assert.equal((result.stdout.match(/filesystem=/g) ?? []).length, 1);
  assert.match(result.stdout, /\/mount with spaces/);
});

test('rejects insufficient total space on a shared mount', async (t) => {
  const { first, second, run } = await fixture(t);
  const result = run(['60000', 'workspace', first, '50000', 'gradle', second]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /insufficient/i);
  assert.match(result.stderr, /required=110000 bytes/);
});

test('fails closed for a missing workspace', async (t) => {
  const { root, run } = await fixture(t);
  assert.notEqual(run(['10', 'workspace', join(root, 'missing')]).status, 0);
});

test('rejects invalid thresholds and malformed df output', async (t) => {
  const normal = await fixture(t);
  assert.notEqual(normal.run(['not-a-number', 'workspace', normal.first]).status, 0);
  const broken = await fixture(t, 'invalid');
  assert.notEqual(broken.run(['10', 'workspace', broken.first]).status, 0);
});


test('fails when df cannot read the target filesystem', async (t) => {
  const { root, first, run } = await fixture(t);
  await writeFile(join(root, 'bin', 'df'), '#!/bin/sh\nexit 1\n');
  assert.notEqual(run(['100', 'workspace', first]).status, 0);
});

test('checks both Android workflows before dependency and native setup', async () => {
  for (const [name, prefix] of [['android-release.yml', 'ADMIN'], ['android-storefront-release.yml', 'STOREFRONT']]) {
    const { readFile } = await import('node:fs/promises');
    const workflow = await readFile(resolve('.github/workflows', name), 'utf8');
    const gate = workflow.indexOf('name: Verify Android build filesystem capacity');
    assert.ok(gate > workflow.indexOf('name: Checkout'));
    assert.ok(gate < workflow.indexOf('name: Setup Node.js'));
    assert.ok(gate < workflow.indexOf('name: Install dependencies'));
    for (const label of ['WORKSPACE', 'PNPM', 'GRADLE', 'TEMP']) {
      assert.match(workflow, new RegExp(`vars\\.ANDROID_${prefix}_${label}_REQUIRED_BYTES`));
    }
  }
});

test('checks separate filesystems against their own budgets', async (t) => {
  const { root, first, second, run } = await fixture(t);
  await writeFile(join(root, 'bin', 'df'), `#!/bin/sh
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
case "$2" in
  *workspace*) printf '/dev/one 1000 1 100 1%% /one\\n' ;;
  *) printf '/dev/two 1000 1 20 1%% /two\\n' ;;
esac
`);
  const result = run(['90000', 'workspace', first, '30000', 'gradle', second]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mount=\/two/);
  assert.match(result.stderr, /required=30000 bytes/);
});
