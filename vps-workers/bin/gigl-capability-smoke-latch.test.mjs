import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./gigl-capability-smoke-latch.sh', import.meta.url));
const sha = 'a'.repeat(40);
const fingerprint = 'b'.repeat(64);

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function fixture({ smokeStatus = 0, identityChanges = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baci-gigl-broker-smoke-'));
  const workerRoot = join(root, 'workers');
  const releasesRoot = join(workerRoot, 'releases');
  const releaseRoot = join(workerRoot, 'releases', sha);
  const bin = join(releaseRoot, 'bin');
  const identityDir = join(releaseRoot, '.github/scripts');
  mkdirSync(join(workerRoot, 'locks'), { recursive: true });
  mkdirSync(join(workerRoot, 'bin'), { recursive: true });
  mkdirSync(releasesRoot, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(identityDir, { recursive: true });
  const installedHelper = join(bin, 'gigl-capability-smoke-latch.sh');
  writeFileSync(installedHelper, readFileSync(script));
  chmodSync(installedHelper, 0o755);
  symlinkSync(sha, join(workerRoot, 'current'));
  mkdirSync(join(workerRoot, 'runtime'), { recursive: true });
  writeFileSync(join(workerRoot, 'runtime/worker.env'), 'GIGL_ENABLED=true\n');
  writeFileSync(join(workerRoot, '.gigl-capability-smoke-ok'), `disabled:${'c'.repeat(40)}:${fingerprint}\n`);

  const identityCalls = join(root, 'identity-calls');
  const identityScript = join(identityDir, 'resolve-isolated-gigl-latch-identity.sh');
  executable(identityScript, `#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 1 ]
[ "$1" = "${workerRoot}" ]
count=0
[ ! -f "${identityCalls}" ] || count="$(cat "${identityCalls}")"
count=$((count + 1))
printf '%s' "$count" > "${identityCalls}"
if [ "${identityChanges ? 'true' : 'false'}" = true ] && [ "$count" -gt 1 ]; then
  printf 'enabled %s\\n' '${'d'.repeat(64)}'
else
  printf 'enabled %s\\n' '${fingerprint}'
fi
`);

  const smoke = join(workerRoot, 'bin/verify-gigl-tracking-worker-capability.sh');
  const smokeRecord = join(root, 'smoke-record');
  executable(smoke, `#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s|%s|%s\\n' "$NODE_ENV" "$BACI_WORKER_PROFILE" "$BACI_WORKER_ENV" "$GIGL_ENV_FILE_AUTHORITATIVE" > "${smokeRecord}"
printf 'fixture secret must never escape\\n'
printf 'fixture secret must never escape\\n' >&2
exit ${smokeStatus}
`);
  const latch = join(workerRoot, '.gigl-capability-smoke-ok');
  const previousLatch = readFileSync(latch, 'utf8');
  return {
    root,
    workerRoot,
    installedHelper,
    smokeRecord,
    latch,
    previousLatch,
    run(extraEnv = {}, args = []) {
      return spawnSync('bash', [installedHelper, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          BACI_EXPECTED_APP_SHA: sha,
          BACI_WORKER_ROOT: workerRoot,
          ...extraEnv,
        },
      });
    },
  };
}

const fixtures = new Set();
function setup(options) {
  const value = fixture(options);
  fixtures.add(value);
  return value;
}
test.afterEach(() => {
  for (const value of fixtures) rmSync(value.root, { recursive: true, force: true });
  fixtures.clear();
});

test('runs the scoped probe and returns a host-local capability receipt', () => {
  const value = setup();
  const result = value.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    smokePassed: true,
    scope: 'enabled',
    installedSha: sha,
    credentialFingerprint: fingerprint,
  });
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /fixture secret/);
  assert.equal(readFileSync(value.latch, 'utf8'), value.previousLatch);
  assert.equal(
    readFileSync(value.smokeRecord, 'utf8'),
    `production|gigl-tracking|${join(value.workerRoot, 'runtime/worker.env')}|1\n`
  );
});

test('keeps the prior latch when the restricted probe fails and suppresses provider output', () => {
  const value = setup({ smokeStatus: 1 });
  const result = value.run();
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(value.latch, 'utf8'), value.previousLatch);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture secret/);
  assert.match(result.stderr, /restricted capability probe was rejected/);
});

test('does not latch when the exact worker SHA is mismatched or changes across smoke', () => {
  const mismatch = setup();
  const mismatchResult = mismatch.run({ BACI_EXPECTED_APP_SHA: 'e'.repeat(40) });
  assert.notEqual(mismatchResult.status, 0);
  assert.equal(readFileSync(mismatch.latch, 'utf8'), mismatch.previousLatch);
  assert.match(mismatchResult.stderr, /does not match the authenticated release/);
  assert.equal(existsSync(mismatch.smokeRecord), false);

  const changing = setup({ identityChanges: true });
  const changingResult = changing.run();
  assert.notEqual(changingResult.status, 0);
  assert.equal(readFileSync(changing.latch, 'utf8'), changing.previousLatch);
  assert.match(changingResult.stderr, /identity changed during smoke/);
});

test('rejects caller-selected command arguments', () => {
  const value = setup();
  const result = value.run({}, ['--anything']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected arguments/);
  assert.equal(readFileSync(value.latch, 'utf8'), value.previousLatch);
});
