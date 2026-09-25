import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { installStatStub } from './running-container-fixture.mjs';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-projector-auth.sh', import.meta.url);

function checkBase(base, stat) {
  return execFileAsync('sh', [
    '-c',
    '. "$1"; running_projector_uid=$(id -u); running_projector_gid=$(id -g); RETIRE_OLLAMA_TEST_BIN="$3"; running_projector_snapshot_base="$2"; running_container_projector_snapshot_base_safe || exit $?; printf accepted',
    'snapshot-base-test',
    helper.pathname,
    base,
    dirname(stat),
  ]);
}

test('requires a private owner or sticky snapshot base', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-projector-base-'));
  try {
    const stat = join(directory, 'stat');
    await installStatStub(stat);
    const unsafeBase = join(directory, 'unsafe');
    const stickyBase = join(directory, 'sticky');
    await mkdir(unsafeBase, { mode: 0o777 });
    await mkdir(stickyBase, { mode: 0o1777 });
    await chmod(unsafeBase, 0o777);
    await chmod(stickyBase, 0o1777);
    await assert.rejects(
      checkBase(unsafeBase, stat),
      (error) => error.code === 2
    );
    assert.equal((await checkBase(stickyBase, stat)).stdout, 'accepted');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('canonicalizes the fallback before validating /tmp-like symlink paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-projector-base-link-'));
  const canonical = join(directory, 'canonical');
  const symlinkedBase = join(directory, 'tmp-like');
  await mkdir(canonical, { mode: 0o700 });
  await symlink(canonical, symlinkedBase, 'dir');
  const canonicalPath = await realpath(canonical);
  try {
    const command = `. "$1"; if [ "$(/usr/bin/id -u)" -eq 0 ]; then SCRIPT_DIR=/var/lib/baci-cwv/preflight-source/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; unset RETIRE_OLLAMA_PROJECTOR_TEST_SOURCE_ROOT RETIRE_OLLAMA_PROJECTOR_TEST_RECEIPT_ROOT; else SCRIPT_DIR=/tmp/projector-source/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; RETIRE_OLLAMA_PROJECTOR_TEST_SOURCE_ROOT=/tmp/projector-source; RETIRE_OLLAMA_PROJECTOR_TEST_RECEIPT_ROOT=/tmp/projector-receipts; fi; RETIRE_OLLAMA_TEST_BIN=/tmp/projector-bin; running_container_projector_stat() { printf '%s:%s:700\\n' "$(/usr/bin/id -u)" "$(/usr/bin/id -g)"; }; running_container_projector_fixed_ancestry() { :; }; running_container_projector_canonical_dir() { :; }; running_container_projector_private_file() { :; }; running_container_projector_snapshot_base_safe() { printf '%s' "$running_projector_snapshot_base"; return 2; }; TEMP_ROOT="$2"; running_container_projector_authorize "$SCRIPT_DIR/retire-ollama-image-filesystem.pl"`;
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        command,
        'snapshot-base-canonicalization-test',
        helper.pathname,
        symlinkedBase,
      ]),
      (error) => {
        assert.equal(error.code, 2);
        assert.equal(error.stdout, canonicalPath);
        return true;
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
