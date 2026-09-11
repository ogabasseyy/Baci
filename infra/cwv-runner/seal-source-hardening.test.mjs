import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  new URL('./seal-source.sh', import.meta.url),
  'utf8'
);
const projector = readFileSync(
  new URL('./retire-ollama-projector-auth.sh', import.meta.url),
  'utf8'
);
const atomicNoReplaceStart = source.indexOf('atomic_noreplace_dir() {');
const atomicNoReplaceEnd = source.indexOf('\nsignal() {', atomicNoReplaceStart);
assert.ok(
  atomicNoReplaceStart >= 0 && atomicNoReplaceEnd > atomicNoReplaceStart
);
const atomicNoReplace = source.slice(atomicNoReplaceStart, atomicNoReplaceEnd);

test('rejects dangling target and receipt symlinks before any root creation', () => {
  assert.match(source, /\[\[ ! -L "\$1" && ! -e "\$1" \]\]/);
  assert.match(source, /absent_leaf "\$target"; absent_leaf "\$receipt"/);
  assert.match(
    source,
    /validate_fixed_root "\$final_root"; validate_fixed_root "\$receipt_root"/
  );
});

test('fails closed on symlinked or unsafe fixed-root ancestry', () => {
  assert.match(
    source,
    /\[\[ ! -L "\$path" \]\] \|\| fail 'unsafe fixed root ancestry'/
  );
  assert.match(
    source,
    /\[\[ "\$strict" != true \|\| "\$mode" == 700 \]\] \|\| fail 'unsafe fixed root'/
  );
  assert.match(
    source,
    /prepare_fixed_root "\$final_root"; prepare_fixed_root "\$receipt_root"/
  );
});

test('rejects minimal and malformed manifests with exact parsed schemas', () => {
  assert.match(source, /readonly JQ=\/usr\/bin\/jq/);
  assert.match(source, /if length != 1 then false/);
  assert.match(source, /manifest is not canonical schema-v1 JSON/);
  assert.match(
    source,
    /exact\(\$m;\["authority","baseSha","entries","mergeSha"/
  );
  assert.match(
    source,
    /exact\(\$m;\["authority","baseSha","entries","policyCanonicalSha256"/
  );
  assert.match(source, /exact\(\.;\["blobSha256","mode","path"\]\)/);
  assert.match(source, /exact\(\.;\["absent","path","status"\]\)/);
  assert.match(source, /all\(\$m\.sourceArchive\.entries\[\]; archive_row\)/);
});

test('publishes without replacement and cleans only matching owned identities', () => {
  assert.match(source, /atomic_noreplace_dir "\$projection" "\$target"/);
  assert.match(source, /renameatx_np\(2\)/);
  assert.match(source, /renameat2\(2\)/);
  assert.match(source, /RENAME_EXCL/);
  assert.match(source, /RENAME_NOREPLACE/);
  assert.match(source, /\$syscall=488/);
  assert.match(source, /\?316/);
  assert.match(source, /\?276/);
  assert.match(source, /\?382/);
  assert.match(source, /\?353/);
  assert.match(
    source,
    /target_identity=\$\("\$STAT" -c '%d:%i' -- "\$projection"\)/
  );
  assert.match(
    source,
    /receipt_identity=\$\("\$STAT" -c '%d:%i' -- "\$receipt_stage"\)/
  );
  assert.match(source, /owned_path_matches "\$path" "\$identity"/);
  assert.match(
    source,
    /cleanup_owned_dir\(\) \{ local path=\$1 identity=\$2 quarantine; quarantine="\$\{path\}\.cleanup\.\$\$";/
  );
  assert.match(source, /cleanup_owned_path "\$target" "\$target_identity"/);
  assert.match(source, /cleanup_owned_path "\$receipt" "\$receipt_identity"/);
  assert.doesNotMatch(source, /"\$RM" -rf -- "\$path"/);
});

test('distinguishes unsupported atomic publication from an ordinary rename failure', () => {
  assert.match(
    source,
    /if atomic_noreplace_dir "\$projection" "\$target"; then :; else atomic_status=\$\?; case "\$atomic_status" in 64\) fail 'atomic no-replace publication unavailable';; \*\) fail 'sealed destination already exists';; esac; fi/
  );
});

test('refuses a destination created between precheck and rename without replacement', () => {
  const root = mkdtempSync('/tmp/baci-cwv-seal-noreplace-race-');
  const sourceDir = join(root, 'source');
  const destination = join(root, 'destination');
  const fakePerl = join(root, 'perl');
  mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, 'source-marker'), 'source\n', 'utf8');
  writeFileSync(
    fakePerl,
    '#!/bin/bash -p\nset -eu\ndestination=$' +
      '{@: -1}\nmkdir "$destination"\nprintf attacker > "$destination/attacker-marker"\nexec /usr/bin/perl "$@"\n',
    'utf8'
  );
  chmodSync(fakePerl, 0o700);
  const result = spawnSync(
    '/bin/bash',
    [
      '-c',
      `set -eu
PERL=${JSON.stringify(fakePerl)}
${atomicNoReplace}
if atomic_noreplace_dir "$1" "$2"; then exit 20; fi
[ -f "$1/source-marker" ]
[ -f "$2/attacker-marker" ]
[ "$(cat "$2/attacker-marker")" = attacker ]
`,
      'seal-source-noreplace-race',
      sourceDir,
      destination,
    ],
    { encoding: 'utf8' }
  );
  try {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('fsyncs and identity-checks every staged receipt publication', () => {
  assert.match(source, /receipt_link\(\)/);
  assert.match(source, /"\$LN" -T -- "\$source" "\$destination"/);
  assert.match(source, /"\$SYNC" -f "\$temporary"/);
  assert.match(source, /tmp_identity/);
  assert.match(source, /cleanup_owned_dir "\$tmp" "\$tmp_identity"/);
});

test('uses safe integer manifest numbers and canonical projector ancestry', () => {
  assert.match(source, /def safe_int:.*9007199254740991/);
  assert.match(projector, /running_container_projector_fixed_ancestry/);
  assert.match(projector, /running_container_projector_canonical_dir/);
  assert.match(projector, /def safeInt:.*9007199254740991/);
});
