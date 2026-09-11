import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  new URL('verify-base-tools.sh', import.meta.url),
  'utf8'
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture({
  duplicate = '',
  extra = false,
  failMove = false,
  omit = '',
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cwv-base-tools-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const roles = [
    'apt-get',
    'awk',
    'awk:alternative',
    'awk:target',
    'base64',
    'bash',
    'chmod',
    'cp',
    'dpkg',
    'dpkg-query',
    'find',
    'gpgv',
    'grep',
    'interpreter:loader',
    'keyring',
    'ldd',
    'library:libc',
    'mkdir',
    'mktemp',
    'mv',
    'readlink',
    'rm',
    'sha256sum',
    'sort',
    'stat',
    'timeout',
    'wc',
    ...(extra ? ['zz-unexpected'] : []),
  ]
    .filter((role) => role !== omit)
    .flatMap((role) => (role === duplicate ? [role, role] : [role]));
  const paths = new Map();
  for (const role of roles) {
    const path = join(root, role.replace(/[:/]/g, '-'));
    writeFileSync(path, `bytes:${role}`);
    paths.set(role, path);
  }
  rmSync(paths.get('awk'));
  rmSync(paths.get('awk:alternative'));
  symlinkSync(paths.get('awk:target'), paths.get('awk:alternative'));
  symlinkSync(paths.get('awk:alternative'), paths.get('awk'));
  const keyring = paths.get('keyring');
  const inventory = join(root, 'inventory.tsv');
  writeFileSync(
    inventory,
    `${roles
      .map((role) => {
        const path = paths.get(role);
        return [
          role,
          path,
          role.startsWith('awk') ? 'mawk' : `pkg-${role.replace(':', '-')}`,
          '1',
          '644',
          '0:0',
          `'${path}'`,
          sha(readFileSync(path)),
        ].join('\t');
      })
      .join('\n')}\n`
  );
  const hash = join(bin, 'sha256sum');
  writeFileSync(hash, '#!/bin/sh\n/usr/bin/shasum -a 256 "$1"\n');
  const stat = join(bin, 'stat');
  writeFileSync(
    stat,
    `#!/bin/sh
case "$1" in
  -Lc) [ "$2" = %a ] && printf 644 || printf 0:0 ;;
  -c) printf "'%s'" "$3" ;;
esac
`
  );
  const dpkg = join(bin, 'dpkg-query');
  const dpkgFixture = `#!/bin/sh\nif [ "$1" = -S ]; then name=\${2##*/}; case "$name" in awk-target) printf "mawk: %s" "$2" ;; *) name=$(printf '%s' "$name" | tr ':' '-'); printf "pkg-%s: %s" "$name" "$2" ;; esac; else printf 1; fi\n`;
  writeFileSync(dpkg, dpkgFixture);
  const move = join(bin, 'mv');
  writeFileSync(
    move,
    failMove ? '#!/bin/sh\nexit 1\n' : '#!/bin/sh\n/bin/mv "$@"\n'
  );
  for (const path of [hash, stat, dpkg, move]) chmodSync(path, 0o700);
  const helper = join(root, 'verify.sh');
  writeFileSync(
    helper,
    source
      .replaceAll('/usr/bin/sha256sum', hash)
      .replaceAll('/usr/bin/stat', stat)
      .replaceAll('/usr/bin/dpkg-query', dpkg)
      .replaceAll('/usr/bin/mv', move)
      .replaceAll('/usr/bin/rm', '/bin/rm')
      .replaceAll(
        '/usr/share/keyrings/ubuntu-archive-keyring.gpg',
        keyring ?? ''
      )
  );
  chmodSync(helper, 0o700);
  return {
    dpkg,
    helper,
    inventory,
    paths,
    receipt: join(root, 'receipt.json'),
  };
}

const base = `ubuntu@sha256:${'a'.repeat(64)}`;
const run = (value) =>
  spawnSync('/bin/bash', [value.helper, base, value.inventory, value.receipt], {
    encoding: 'utf8',
  });

test('runs the generated dpkg-query fixture under POSIX sh', () => {
  const value = fixture();
  const path = '/tmp/interpreter:loader';
  const result = spawnSync('/bin/dash', [value.dpkg, '-S', path], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `pkg-interpreter-loader: ${path}`);
});

test('binds every base command, interpreter, transitive library, and keyring', () => {
  const value = fixture();
  const result = run(value);
  assert.equal(
    result.status,
    0,
    `${result.error ?? ''} ${result.signal ?? ''} ${result.stderr}`
  );
  const receipt = JSON.parse(readFileSync(value.receipt, 'utf8'));
  assert.equal(receipt.baseImageDigest, base);
  assert.ok(receipt.tools.some(({ role }) => role.startsWith('interpreter:')));
  assert.ok(receipt.tools.some(({ role }) => role.startsWith('library:')));
  assert.match(result.stdout, /^[0-9a-f]{64}$/);
});

test('uses a real awk alternatives chain while querying only its mawk target', () => {
  const value = fixture();
  assert.equal(
    readlinkSync(value.paths.get('awk')),
    value.paths.get('awk:alternative')
  );
  assert.equal(
    readlinkSync(value.paths.get('awk:alternative')),
    value.paths.get('awk:target')
  );
  assert.equal(run(value).status, 0);
});

test('fails closed on tool byte drift or incomplete transitive inventory', () => {
  const drift = fixture();
  writeFileSync(drift.paths.get('awk'), 'changed');
  assert.notEqual(run(drift).status, 0);
  assert.notEqual(run(fixture({ omit: 'interpreter:loader' })).status, 0);
  assert.notEqual(run(fixture({ omit: 'library:libc' })).status, 0);
});

test('requires the complete pre-verification tool set and rejects role drift', () => {
  const required = source.match(/required=\(([^)]+)\)/)?.[1].split(' ');
  assert.deepEqual(required, [
    'apt-get',
    'awk',
    'awk:alternative',
    'awk:target',
    'base64',
    'bash',
    'chmod',
    'cp',
    'dpkg',
    'dpkg-query',
    'find',
    'gpgv',
    'grep',
    'ldd',
    'mkdir',
    'mktemp',
    'mv',
    'readlink',
    'rm',
    'sha256sum',
    'sort',
    'stat',
    'timeout',
    'wc',
    'keyring',
  ]);
  assert.notEqual(run(fixture({ omit: 'apt-get' })).status, 0);
  assert.notEqual(run(fixture({ extra: true })).status, 0);
  assert.notEqual(run(fixture({ duplicate: 'stat' })).status, 0);
});

test('removes a temporary receipt when publication fails', () => {
  const value = fixture({ failMove: true });
  const result = run(value);
  assert.notEqual(result.status, 0);
  assert.deepEqual(
    readdirSync(value.receipt.slice(0, value.receipt.lastIndexOf('/'))).filter(
      (name) => name.startsWith('receipt.json.tmp.')
    ),
    []
  );
});

test('publishes the receipt digest without a tautological self-check', () => {
  assert.doesNotMatch(source, /receipt_sha=/);
  assert.doesNotMatch(source, /digest "\$receipt"\) == "\$receipt_sha"/);
  assert.match(source, /printf '%s' "\$\(digest "\$receipt"\)"/);
});

test('rejects a receipt whose immediate parent is a symlink', () => {
  const value = fixture();
  const target = join(
    value.receipt.slice(0, value.receipt.lastIndexOf('/')),
    'target'
  );
  const symlink = join(
    value.receipt.slice(0, value.receipt.lastIndexOf('/')),
    'linked'
  );
  mkdirSync(target);
  symlinkSync(target, symlink);
  value.receipt = join(symlink, 'receipt.json');
  assert.notEqual(run(value).status, 0);
});
