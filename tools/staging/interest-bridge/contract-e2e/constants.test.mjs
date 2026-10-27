import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const constantsUrl = new URL('./constants.mjs', import.meta.url);
const recoveredRoot = realpathSync(
  fileURLToPath(new URL('../../../../', import.meta.url))
);
const temporaryRoot = mkdtempSync(join(tmpdir(), 'baci-contract-e2e-config-'));
const postgresBin = join(temporaryRoot, 'postgres-bin');
mkdirSync(postgresBin);
for (const binary of ['initdb', 'pg_ctl', 'postgres', 'psql']) {
  const path = join(postgresBin, binary);
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' '${binary} (PostgreSQL) 18.6'\n`
  );
  chmodSync(path, 0o755);
}
const incompletePostgresBin = join(temporaryRoot, 'incomplete-postgres-bin');
mkdirSync(incompletePostgresBin);
const postgres17Bin = join(temporaryRoot, 'postgres-17-bin');
mkdirSync(postgres17Bin);
for (const binary of ['initdb', 'pg_ctl', 'postgres', 'psql']) {
  const path = join(postgres17Bin, binary);
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' '${binary} (PostgreSQL) 17.6'\n`
  );
  chmodSync(path, 0o755);
}
after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

function readConfiguration(receiverRoot, postgresBinPath) {
  const env = {};
  if (receiverRoot !== undefined)
    env.BACI_CONTRACT_E2E_RECEIVER_ROOT = receiverRoot;
  if (postgresBinPath !== undefined)
    env.BACI_CONTRACT_E2E_POSTGRES_BIN = postgresBinPath;
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { CONTRACT_E2E } from ${JSON.stringify(constantsUrl.href)};
       process.stdout.write(JSON.stringify({root: CONTRACT_E2E.receiverRoot,
         postgresBin: CONTRACT_E2E.postgresBin,
         frozen: Object.isFrozen(CONTRACT_E2E), pin: CONTRACT_E2E.runtimeStoragePin}));`,
    ],
    { encoding: 'utf8', env }
  );
}

test('uses explicit receiver and PostgreSQL roots and retains physical guards', () => {
  const result = readConfiguration(recoveredRoot, postgresBin);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    root: recoveredRoot,
    postgresBin: realpathSync(postgresBin),
    frozen: true,
    pin: '7686901100561231906',
  });
});

test('requires an explicit receiver root', () => {
  const result = readConfiguration(undefined, postgresBin);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Contract receiver source root required/);
});

test('requires an explicit PostgreSQL binary directory', () => {
  const result = readConfiguration(recoveredRoot, undefined);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /Contract PostgreSQL 18 binary directory required/
  );
});

for (const [label, candidate] of [
  ['empty', ''],
  ['relative', 'relative/source'],
  ['missing', join(temporaryRoot, 'missing-receiver')],
  ['file', fileURLToPath(constantsUrl)],
  ['unrelated directory', tmpdir()],
]) {
  test(`refuses ${label} receiver root without fallback`, () => {
    const result = readConfiguration(candidate, postgresBin);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Contract receiver source root refused/);
  });
}

for (const [label, candidate] of [
  ['empty', ''],
  ['relative', 'relative/postgres/bin'],
  ['missing', join(temporaryRoot, 'missing-postgres-bin')],
  ['file', fileURLToPath(constantsUrl)],
  ['unrelated directory', tmpdir()],
  ['missing required executables', incompletePostgresBin],
  ['PostgreSQL 17 binaries', postgres17Bin],
]) {
  test(`refuses ${label} PostgreSQL binary directory`, () => {
    const result = readConfiguration(recoveredRoot, candidate);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(
      result.stderr,
      /Contract PostgreSQL 18 binary directory refused/
    );
  });
}

test('allocates its disposable cluster under the operating-system temp directory', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { createDisposablePostgresDirectory } from ${JSON.stringify(new URL('./postgres.mjs', import.meta.url).href)};
       process.stdout.write(createDisposablePostgresDirectory());`,
    ],
    {
      encoding: 'utf8',
      env: {
        TMPDIR: tmpdir(),
        BACI_CONTRACT_E2E_RECEIVER_ROOT: recoveredRoot,
        BACI_CONTRACT_E2E_POSTGRES_BIN: postgresBin,
      },
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const directory = result.stdout;
  try {
    assert.equal(realpathSync(directory), directory);
    const fromTemporaryRoot = relative(realpathSync(tmpdir()), directory);
    assert.equal(
      fromTemporaryRoot !== '' &&
        fromTemporaryRoot !== '..' &&
        !fromTemporaryRoot.startsWith(
          `..${process.platform === 'win32' ? '\\' : '/'}`
        ) &&
        !isAbsolute(fromTemporaryRoot),
      true
    );
    assert.match(directory, /\/baci-contract-e2e-[^/]+$/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
