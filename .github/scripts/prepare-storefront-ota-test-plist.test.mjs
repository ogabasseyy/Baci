import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./prepare-storefront-ota-test-plist.py', import.meta.url));
const projectUrl = 'https://u.expo.dev/c6c1897b-cac8-49b0-85f9-3d277aecc379';

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-test-plist-'));
  const source = path.join(directory, 'target.plist');
  const output = path.join(directory, 'test.plist');
  const target = {
    EXUpdatesEnabled: true,
    EXUpdatesRuntimeVersion: '2.1.663',
    EXUpdatesURL: projectUrl,
    EXUpdatesRequestHeaders: { 'expo-channel-name': 'production', 'x-test-header': 'preserved' },
    EXUpdatesCheckOnLaunch: 'ERROR_RECOVERY_ONLY',
  };
  try {
    execFileSync('python3', ['-c', 'import json,plistlib,sys; plistlib.dump(json.load(sys.stdin),open(sys.argv[1],"wb"))', source], {
      input: JSON.stringify(target),
    });
    await run({ directory, source, output, target });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function args(source, output, runtime = '2.1.663', channel = 'ota-test-wallet-663', url = projectUrl) {
  return [script, '--source', source, '--output', output, '--runtime', runtime, '--channel', channel, '--source-channel', 'production', '--updates-url', url];
}

test('creates an isolated channel config while preserving the target runtime and headers', async () => {
  await fixture(async ({ source, output, target }) => {
    const before = await readFile(source);
    execFileSync('python3', args(source, output), { stdio: 'pipe' });
    const result = JSON.parse(execFileSync('python3', ['-c', 'import json,plistlib,sys; print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', output], { encoding: 'utf8' }));
    assert.deepEqual(result, { ...target, EXUpdatesRequestHeaders: { ...target.EXUpdatesRequestHeaders, 'expo-channel-name': 'ota-test-wallet-663' } });
    assert.deepEqual(await readFile(source), before);
  });
});

test('rejects an unsafe channel, a mismatched target and existing output', async () => {
  await fixture(async ({ source, output }) => {
    assert.throws(() => execFileSync('python3', args(source, output, '2.1.663', 'production'), { stdio: 'pipe' }));
    assert.throws(() => execFileSync('python3', args(source, output, '2.1.664'), { stdio: 'pipe' }));
    assert.throws(() => execFileSync('python3', args(source, output, '2.1.663', 'ota-test-wallet', 'https://example.invalid'), { stdio: 'pipe' }));
    assert.throws(() => execFileSync('python3', args(source, source), { stdio: 'pipe' }));
    execFileSync('python3', args(source, output), { stdio: 'pipe' });
    assert.throws(() => execFileSync('python3', args(source, output), { stdio: 'pipe' }));
  });
});

test('rejects a target whose OTA updates are disabled', async () => {
  await fixture(async ({ source, output, target }) => {
    execFileSync('python3', ['-c', 'import json,plistlib,sys; plistlib.dump(json.load(sys.stdin),open(sys.argv[1],"wb"))', source], {
      input: JSON.stringify({ ...target, EXUpdatesEnabled: false }),
    });
    assert.throws(() => execFileSync('python3', args(source, output), { stdio: 'pipe' }));
  });
});
