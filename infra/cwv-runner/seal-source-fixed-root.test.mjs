import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, 'seal-source.sh'), 'utf8');

const knownRootStart = source.indexOf('assert_known_root()');
const fragmentStart =
  knownRootStart >= 0 ? knownRootStart : source.indexOf('fixed_root_chain()');
const fragmentEnd = source.indexOf('\nabsent_leaf()');
assert.ok(fragmentStart >= 0, 'fixed-root validation anchor is present');
assert.ok(
  fragmentEnd > fragmentStart,
  'fixed-root fragment has a valid boundary'
);
const fragment = source.slice(fragmentStart, fragmentEnd);
const validationFragment = source.slice(
  source.indexOf('validate_fixed_dir()'),
  fragmentEnd
);

function validateUnknownRoot(functionName) {
  return spawnSync(
    '/bin/bash',
    [
      '-c',
      `set -u
fail() { printf '%s\\n' "$*" >&2; exit 1; }
validate_fixed_dir() { :; }
MKDIR=/bin/mkdir
${fragment}
${functionName} /tmp/not-a-baci-fixed-root`,
    ],
    { encoding: 'utf8' }
  );
}

for (const functionName of ['validate_fixed_root', 'prepare_fixed_root']) {
  test(`${functionName} rejects an unknown root in the parent shell`, () => {
    const result = validateUnknownRoot(functionName);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid fixed root/);
  });
}

test('fails explicitly when sealed temporary directory creation fails', () => {
  assert.match(
    source,
    /"\$MKDIR" -m 0700 -- "\$tmp" \|\| fail 'sealed temporary directory unavailable'/
  );
});

test('creates traversable missing parents and a sealed leaf', () => {
  const fixture = mkdtempSync(join('/tmp', 'baci-cwv-fixed-root-modes-'));
  const log = join(fixture, 'mkdir.log');
  const mkdirRecorder = join(fixture, 'mkdir-recorder.sh');
  const chain = [
    join(fixture, 'parent'),
    join(fixture, 'parent', 'intermediate'),
    join(fixture, 'parent', 'intermediate', 'sealed'),
  ];
  writeFileSync(
    mkdirRecorder,
    '#!/bin/bash -p\nset -eu\nmode=\'\'\nwhile (($#)); do case "$1" in -m) mode=$2; shift 2 ;; --) shift; break ;; *) shift ;; esac; done\nprintf \'%s %s\\n\' "$mode" "$1" >> "$LOG"\nexec /bin/mkdir -m "$mode" -- "$1"\n',
    'utf8'
  );
  chmodSync(mkdirRecorder, 0o700);
  const chainArguments = chain.map((path) => JSON.stringify(path)).join(' ');
  const result = spawnSync(
    '/bin/bash',
    [
      '-c',
      `set -eu
fail() { printf '%s\\n' "$*" >&2; exit 1; }
MKDIR=${JSON.stringify(mkdirRecorder)}
${fragment}
assert_known_root() { :; }
fixed_root_chain() { printf '%s\\n' ${chainArguments}; }
validate_fixed_dir() { :; }
prepare_fixed_root ${JSON.stringify(chain.at(-1))}`,
    ],
    { encoding: 'utf8', env: { ...process.env, LOG: log } }
  );
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split(' ', 1)[0]),
      ['0755', '0755', '0700']
    );
    assert.equal(statSync(chain[0]).mode & 0o777, 0o755);
    assert.equal(statSync(chain[1]).mode & 0o777, 0o755);
    assert.equal(statSync(chain[2]).mode & 0o777, 0o700);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});

test('still rejects a pre-existing writable fixed-root parent', () => {
  const fixture = mkdtempSync(join('/tmp', 'baci-cwv-fixed-root-unsafe-'));
  const unsafe = join(fixture, 'unsafe');
  const statFake = join(fixture, 'stat.sh');
  mkdirSync(unsafe);
  writeFileSync(statFake, "#!/bin/bash -p\nprintf '0:0775\\n'\n", 'utf8');
  chmodSync(statFake, 0o700);
  const result = spawnSync(
    '/bin/bash',
    [
      '-c',
      `set -eu
fail() { printf '%s\\n' "$*" >&2; exit 1; }
STAT=${JSON.stringify(statFake)}
${validationFragment}
validate_fixed_dir ${JSON.stringify(unsafe)} false`,
    ],
    { encoding: 'utf8' }
  );
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsafe fixed root ancestry/);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});
