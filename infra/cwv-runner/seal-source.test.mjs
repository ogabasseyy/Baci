// biome-ignore-all format: compact sealing assertions remain one focused contract.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSourceArchive } from './source-archive.mjs';

const path = new URL('./seal-source.sh', import.meta.url).pathname;
const source = readFileSync(path, 'utf8');
const shell = (...args) => spawnSync('/bin/bash', args, { encoding: 'utf8' });
const rootMountFixtureAvailable =
  process.platform === 'linux' &&
  spawnSync('sudo', ['-n', 'unshare', '--mount', '--fork', '/usr/bin/true']).status === 0;

test('is syntactically valid and refuses incomplete arguments before a mutation path', () => {
  assert.equal(shell('-n', path).status, 0);
  const result = shell(path, '--destination', 'final');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage/);
});
test('uses a fixed privileged Bash that ignores environment-selected startup code', () => {
  assert.match(source, /^#!\/bin\/bash -p\n/);
  const root = mkdtempSync(join(tmpdir(), 'baci-cwv-bash-env-'));
  const startup = join(root, 'startup.sh');
  writeFileSync(
    startup,
    "printf 'environment startup code ran\\n' >&2\n",
    'utf8'
  );
  try {
    const result = spawnSync(path, ['--destination', 'final'], {
      encoding: 'utf8',
      env: { ...process.env, BASH_ENV: startup },
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /environment startup code ran/);
    assert.match(result.stderr, /usage/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
test('uses only closed flags, fixed tools, root copy checks, and atomic destinations', () => {
  for (const flag of [
    '--destination',
    '--source-sha',
    '--source-archive',
    '--source-archive-sha256',
    '--source-manifest',
    '--source-manifest-sha256',
  ])
    assert.match(source, new RegExp(flag));
  for (const literal of [
    '/bin/cp',
    '/usr/bin/stat',
    '/usr/bin/sha256sum',
    '/bin/chown',
    '/bin/chmod',
    '/var/lib/baci-cwv/preflight-source',
    '/srv/baci-cwv/source',
    '/srv/baci-cwv/source-receipts',
  ])
    assert.match(
      source,
      new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  assert.match(source, /input is not a regular file/);
  assert.match(source, /root-copied input digest mismatch/);
  assert.match(source, /sealed destination already exists/);
  assert.match(source, /--no-same-owner --no-same-permissions --no-recursion/);
});
test('seals only a complete regular-file archive projection and rejects unsafe members', () => {
  for (const refusal of [
    'unsafe archive member name',
    'nonregular extracted member',
    'hardlinked extracted member',
    'archive member set mismatch',
    'extracted member hash mismatch',
    'manifest archive rows are not sorted',
  ])
    assert.match(source, new RegExp(refusal));
  assert.match(source, /sourceArchive/);
  assert.match(source, /reviewedHeadSha/);
  assert.match(source, /mergeSha/);
  assert.match(source, /trap cleanup EXIT/);
});
test('resolves extracted members at their full manifest paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-cwv-prefixed-archive-'));
  const archive = join(root, 'source.tar');
  const member = 'infra/cwv-runner/example.txt';
  const bytes = Buffer.from('sealed source\n');
  writeFileSync(
    archive,
    createSourceArchive([{ bytes, mode: '100644', path: member }])
  );
  try {
    const result = spawnSync('/usr/bin/tar', ['-xf', archive, '-C', root], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(join(root, member)), bytes);
    assert.deepEqual(
      readFileSync(join(root, 'infra/cwv-runner', 'example.txt')),
      bytes
    );
    assert.match(source, /local file="\$tree\/\$path"/);
    assert.match(source, /sub\(root, ""\)/);
    assert.match(source, /projection="\$tree\/infra\/cwv-runner"/);
    assert.match(source, /atomic_noreplace_dir "\$projection" "\$target"/);
    assert.doesNotMatch(source, /"\$MV" -T -- "\$tree" "\$target"/);
    assert.doesNotMatch(source, /\$\{path#infra\/cwv-runner\/\}/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
test('extracts reordered source archive object keys without textual key-order coupling', () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-cwv-reordered-manifest-'));
  const manifest = join(root, 'manifest.json');
  try {
    writeFileSync(manifest, JSON.stringify({ sourceArchive: { entries: [{ path: 'infra/cwv-runner/example file.txt', mode: '100644', blobSha256: 'a'.repeat(64) }] } }));
    const filter = '.[0].sourceArchive.entries[] | [.path, .mode, .blobSha256] | @tsv';
    const result = spawnSync('/usr/bin/jq', ['-r', '-s', filter, manifest], { encoding: 'utf8' });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `infra/cwv-runner/example file.txt\t100644\t${'a'.repeat(64)}\n`);
    assert.match(source, /sourceArchive\.entries\[\] \| \[\.path, \.mode, \.blobSha256\] \| @tsv/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
test('self-copies and raw-hash-verifies the first root helper before inner execution', () => {
  for (const token of [
    'BACI_CWV_SEAL_SOURCE_RAW_SHA',
    '--sealed-inner',
    'helper raw digest mismatch',
    'helper is not a regular file',
    '0500',
    '0700',
  ])
    assert.match(
      source,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
});
test('runs the verified unique internal self-copy outside the noexec runtime mount', () => {
  assert.doesNotMatch(source, /readonly SELF_ROOT=\/run\//);
  assert.match(source, /readonly SELF_ROOT=\/var\/lib\/baci-cwv\/seal-source/);
  assert.match(source, /readonly MKTEMP=\/usr\/bin\/mktemp/);
  assert.match(source, /"\$MKTEMP" -d "\$SELF_ROOT\/work\.XXXXXXXX"/);
  assert.match(source, /exec "\$copied" --sealed-inner "\$@"/);
  assert.match(source, /cleanup_self_copy/);
  assert.match(source, /\[\[ -d "\$SELF_PARENT" && ! -L "\$SELF_PARENT" \]\]/);
});
test(
  'removes its unique self-copy when raw verification or lock acquisition fails',
  { skip: !rootMountFixtureAvailable, timeout: 30_000 },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-cwv-outer-cleanup-'));
    const fixture = join(root, 'fixture.sh');
    const sourceSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    writeFileSync(
      fixture,
      [
        'set -eu',
        'mount --make-rprivate /',
        'mount -t tmpfs -o mode=0755 tmpfs /var/lib',
        'mount -t tmpfs -o mode=0755 tmpfs /srv',
        "printf x > /run/archive; printf '{}' > /run/manifest",
        'chown root:root /run/archive /run/manifest; chmod 0600 /run/archive /run/manifest',
        "archive_sha=$(/usr/bin/sha256sum /run/archive | /usr/bin/awk '{print $1}')",
        "manifest_sha=$(/usr/bin/sha256sum /run/manifest | /usr/bin/awk '{print $1}')",
        `if BACI_CWV_SEAL_SOURCE_RAW_SHA=${'0'.repeat(64)} ${JSON.stringify(path)} --destination final --source-sha ${sourceSha} --source-archive /run/archive --source-archive-sha256 "$archive_sha" --source-manifest /run/manifest --source-manifest-sha256 "$manifest_sha" >/run/result.out 2>/run/result.err; then exit 90; fi`,
        "grep -q 'helper raw digest mismatch' /run/result.err",
        '[ -z "$(find /var/lib/baci-cwv/seal-source -mindepth 1 -type d -print -quit)" ]',
        'parent=/var/lib/baci-cwv/seal-source/work.ABC12345',
        `mkdir -m 0700 "$parent"; cp ${JSON.stringify(path)} "$parent/seal-source.sh"`,
        'chown root:root "$parent" "$parent/seal-source.sh"; chmod 0500 "$parent/seal-source.sh"',
        'exec 9</var/lib/baci-cwv/seal-source; /usr/bin/flock -n 9',
        `if BACI_CWV_SEAL_SOURCE_RAW_SHA=${'0'.repeat(64)} "$parent/seal-source.sh" --sealed-inner --destination final --source-sha ${sourceSha} --source-archive /run/archive --source-archive-sha256 "$archive_sha" --source-manifest /run/manifest --source-manifest-sha256 "$manifest_sha" >/run/result.out 2>/run/result.err; then exit 91; fi`,
        "grep -q 'source seal already running' /run/result.err",
        '[ ! -e "$parent" ]',
        '/usr/bin/flock -u 9; exec 9<&-',
      ].join('\n'),
      'utf8'
    );
    try {
      const result = spawnSync('sudo', ['-n', 'unshare', '--mount', '--fork', '/bin/bash', fixture], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);
test('uses a new unique copy and serializes publication under the sealed root lock', () => {
  assert.match(source, /work\.XXXXXXXX/);
  assert.match(source, /readonly FLOCK=\/usr\/bin\/flock/);
  assert.match(source, /exec 9<"\$SELF_ROOT"/);
  assert.match(source, /"\$FLOCK" -n 9 \|\| fail 'source seal already running'/);
  assert.match(source, /atomic_noreplace_dir "\$projection" "\$target"/); assert.match(source, /cleanup_owned_dir\(\)[\s\S]*atomic_noreplace_dir/); assert.match(source, /cleanup_owned_dir\(\) \{ local path=\$1 identity=\$2 quarantine; quarantine="\$\{path\}\.cleanup\.\$\$";/);
  assert.match(source, /unsafe self-copy parent/);
});
test(
  'uses the real helper after a noexec runtime control fails and leaves no work child',
  { skip: !rootMountFixtureAvailable, timeout: 30_000 },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-cwv-noexec-fixture-'));
    const fixture = join(root, 'fixture.sh');
    const raw = spawnSync('/usr/bin/sha256sum', [path], { encoding: 'utf8' }).stdout.split(/\s+/)[0];
    const sourceSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    writeFileSync(
      fixture,
      [
        'set -eu',
        'mount --make-rprivate /',
        'mount -t tmpfs -o noexec tmpfs /run',
        "printf '#!/bin/sh\\nexit 0\\n' > /run/noexec-control",
        'chmod 0500 /run/noexec-control',
        'if /run/noexec-control >/dev/null 2>&1; then exit 90; else control=$?; fi',
        '[ "$control" -eq 126 ] || exit 91',
        'mount -t tmpfs -o mode=0755 tmpfs /var/lib',
        'mount -t tmpfs -o mode=0755 tmpfs /srv',
        "printf x > /run/archive; printf '{}' > /run/manifest",
        'chown root:root /run/archive /run/manifest; chmod 0600 /run/archive /run/manifest',
        "archive_sha=$(/usr/bin/sha256sum /run/archive | /usr/bin/awk '{print $1}')",
        "manifest_sha=$(/usr/bin/sha256sum /run/manifest | /usr/bin/awk '{print $1}')",
        `if BACI_CWV_SEAL_SOURCE_RAW_SHA=${raw} ${JSON.stringify(path)} --destination final --source-sha ${sourceSha} --source-archive /run/archive --source-archive-sha256 "$archive_sha" --source-manifest /run/manifest --source-manifest-sha256 "$manifest_sha" >/run/result.out 2>/run/result.err; then exit 92; fi`,
        "grep -q 'manifest is not canonical schema-v1 JSON' /run/result.err",
        `[ ! -e /srv/baci-cwv/source/${sourceSha} ]`,
        '[ -z "$(find /var/lib/baci-cwv/seal-source -mindepth 1 -type d -print -quit)" ]',
      ].join('\n'),
      'utf8'
    );
    try {
      const result = spawnSync('sudo', ['-n', 'unshare', '--mount', '--fork', '/bin/bash', fixture], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
);
test('cleans up and exits with the received signal status', () => {
  assert.doesNotMatch(source, /readonly KILL|wait "\$child"/);
  assert.match(source, /exit "\$code"/);
  assert.match(source, /trap 'signal HUP 129' HUP/);
  assert.match(source, /trap 'signal INT 130' INT/);
  assert.match(source, /trap 'signal TERM 143' TERM/);
});
test('rolls back owned publication before commit and preserves it after final fsync', () => {
  assert.match(source, /tmp='' tmp_identity='' target='' receipt='' receipt_stage='' target_owned=false receipt_owned=false target_identity='' receipt_identity=''.*committed=false/);
  assert.match(source, /if \[\[ "\$committed" != true \]\]; then/);
  assert.match(source, /cleanup_owned_path "\$receipt" "\$receipt_identity"/);
  assert.match(source, /cleanup_owned_path "\$target" "\$target_identity"/);
  assert.match(source, /trap cleanup EXIT[\s\S]*target_identity=\$\("\$STAT" -c '%d:%i' -- "\$projection"\)[\s\S]*target_owned=true[\s\S]*atomic_noreplace_dir "\$projection" "\$target"/);
  assert.match(source, /trap cleanup EXIT[\s\S]*receipt_identity=\$\("\$STAT" -c '%d:%i' -- "\$receipt_stage"\)[\s\S]*receipt_owned=true[\s\S]*copy_receipt_file[\s\S]*atomic_noreplace_dir "\$receipt_stage" "\$receipt"/);
  assert.match(source, /"\$SYNC" -f "\$receipt_stage" \|\| fail 'receipt staging directory sync failed'[\s\S]*atomic_noreplace_dir "\$receipt_stage" "\$receipt"[\s\S]*"\$SYNC" -f "\$receipt_root" \|\| fail 'receipt root sync failed'; "\$SYNC" -f "\$final_root" \|\| fail 'sealed root sync failed'\ncommitted=true/);
});
test('binds the sealed tree rehash into the immutable receipt', () => {
  assert.match(source, /sealedTreeSha256/);
  assert.match(source, /sealed tree digest mismatch/);
  assert.match(source, /tree\.sha256/);
});
test('keeps manifest-derived file modes intact through final sealing and receipt publication', () => {
  assert.match(
    source,
    /"\$CHMOD" "\$\(\[\[ "\$mode" == 100755 \]\] && printf 0755 \|\| printf 0644\)" -- "\$file"/
  );
  assert.match(
    source,
    /secure_tree_directories\(\) \{\n {2}"\$FIND" "\$1" -type d -exec "\$CHMOD" 0700 -- \{\} \+\n\}/
  );
  assert.match(
    source,
    /\$CHOWN" -R root:root -- "\$tree"; secure_tree_directories "\$tree"\ntree_digest=\$\(sha "\$actual"\)/
  );
  assert.match(source, /sealedTreeSha256/);
  assert.match(source, /"\$CHOWN" -R root:root -- "\$target" "\$receipt_stage" \|\| fail 'sealed ownership hardening failed'/);
  assert.match(source, /secure_tree_directories "\$target" \|\| fail 'sealed directory hardening failed'/);
  assert.match(source, /"\$PERL" -MFile::Find[\s\S]*\$s\[4\]==0&&\$s\[5\]==0&&\(\$s\[2\]&0022\)==0[\s\S]*"\$target" \|\| fail 'sealed directory verification failed'/);
  assert.doesNotMatch(source, /\$CHMOD" -R 0700 -- "\$tree"|\$CHMOD" -R 0700 -- "\$target"/);
});
test('keeps the preflight schema disjoint from final merge sealing', () => {
  assert.match(source, /preflight-v1/);
  assert.match(source, /manifest is not canonical schema-v1 JSON/);
  assert.match(source, /\$m\.mergeSha==\$source_sha/);
  assert.match(source, /\$m\.reviewedHeadSha==\$source_sha/);
  assert.match(source, /\$destination=="final"[\s\S]*\$m\.mergeSha==\$source_sha/);
  assert.match(source, /\$destination=="scan"[\s\S]*\$m\.reviewedHeadSha==\$source_sha/);
});
test('rejects duplicate paths in both manifest arrays without weakening sorted order', () => {
  for (const pattern of [/\[ \$m\.entries\[\]\.path \] == \(\[ \$m\.entries\[\]\.path \] \| sort\)/, /\[ \$m\.sourceArchive\.entries\[\]\.path \] == \(\[ \$m\.sourceArchive\.entries\[\]\.path \] \| sort\)/, /manifest contains duplicate paths/, /\$m\.entries\[\]\?\.path\] \| unique \| length/, /\$m\.sourceArchive\.entries\[\]\?\.path\] \| unique \| length/]) assert.match(source, pattern);
});
test('arms cleanup before publishing destinations', () => {
  assert.match(source, /target_identity=\$\("\$STAT" -c '%d:%i' -- "\$projection"\) \|\| fail 'sealed target identity unavailable'; target_owned=true/);
  assert.match(source, /receipt_identity=\$\("\$STAT" -c '%d:%i' -- "\$receipt_stage"\) \|\| fail 'sealed receipt identity unavailable'; receipt_owned=true/);
});
