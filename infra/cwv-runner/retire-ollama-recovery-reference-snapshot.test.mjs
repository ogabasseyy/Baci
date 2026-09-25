import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('refuses an EnvironmentFile changed after capture before evidence parsing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-reference-'));
  const bin = join(directory, 'bin');
  const environment = join(directory, 'ollama.env');
  const mutationFlag = join(directory, 'mutated');
  try {
    await mkdir(bin);
    await chmod(directory, 0o777);
    await writeFile(environment, 'OLLAMA_HOST=http://127.0.0.1:11434\n');
    await chmod(environment, 0o666);
    await writeFile(
      join(bin, 'readlink'),
      '#!/bin/sh\nif [ "$1" = -f ]; then shift; [ "$1" = -- ] && shift; printf "%s\\n" "$1"; else exec /usr/bin/readlink "$@"; fi\n'
    );
    await writeFile(
      join(bin, 'stat'),
      '#!/bin/sh\ncase "$2" in %F) printf "regular file\\n";; *) printf "1:2:81a4:20:0:0:644\\n";; esac\n'
    );
    await writeFile(
      join(bin, 'findmnt'),
      '#!/bin/sh\nprintf "/ fixture tmpfs ro\\n"\n'
    );
    await writeFile(
      join(bin, 'sha256sum'),
      '#!/bin/sh\nif [ "$1" != "$RETIRE_OLLAMA_MUTATION_TARGET" ] && [ ! -e "$RETIRE_OLLAMA_MUTATION_FLAG" ] && grep -qx "OLLAMA_HOST=http://127.0.0.1:11434" "$1"; then printf "OLLAMA_HOST=https://example.invalid\\n" >"$RETIRE_OLLAMA_MUTATION_TARGET"; : >"$RETIRE_OLLAMA_MUTATION_FLAG"; fi\nexec /usr/bin/shasum -a 256 "$@"\n'
    );
    await Promise.all(
      ['readlink', 'stat', 'findmnt', 'sha256sum'].map((name) =>
        chmod(join(bin, name), 0o755)
      )
    );

    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          '. "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; RECOVERY_RECORDS="[]"; deps="[]"; init_temp_root; trap cleanup_temp EXIT; recovery_record_environment "$2" 0',
          'recovery-reference-snapshot-test',
          script.pathname,
          environment,
        ],
        {
          env: {
            ...process.env,
            RETIRE_OLLAMA_TEST_BIN: bin,
            RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
            RETIRE_OLLAMA_MUTATION_FLAG: mutationFlag,
            RETIRE_OLLAMA_MUTATION_TARGET: environment,
          },
          ...(process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {}),
        }
      ),
      (error) =>
        error.code === 78 &&
        /recovery reference changed during capture/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses a present non-regular EnvironmentFile without a captured snapshot', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-environment-type-')
  );
  const environment = join(directory, 'environment-directory');
  try {
    await mkdir(environment);
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          '. "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; recovery_record_path() { RECOVERY_REFERENCE_SNAPSHOT=""; }; init_temp_root; trap cleanup_temp EXIT; recovery_record_environment "$2" 1',
          'recovery-reference-type-test',
          script.pathname,
          environment,
        ],
        {
          env: {
            ...process.env,
            RETIRE_OLLAMA_TEST_BIN: '/sbin',
            RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
          },
        }
      ),
      (error) =>
        error.code === 65 &&
        /unsafe recovery EnvironmentFile/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses a replacement after the live-content revalidation', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-final-reference-')
  );
  const bin = join(directory, 'bin');
  const environment = join(directory, 'ollama.env');
  const mutationFlag = join(directory, 'mutated');
  try {
    await mkdir(bin);
    await chmod(directory, 0o777);
    await writeFile(environment, 'OLLAMA_HOST=http://127.0.0.1:11434\n');
    await chmod(environment, 0o666);
    await writeFile(
      join(bin, 'readlink'),
      '#!/bin/sh\nif [ "$1" = -f ]; then shift; [ "$1" = -- ] && shift; printf "%s\\n" "$1"; else exec /usr/bin/readlink "$@"; fi\n'
    );
    await writeFile(
      join(bin, 'stat'),
      '#!/bin/sh\ncase "$2" in %F) printf "regular file\\n";; *) if [ -e "$RETIRE_OLLAMA_MUTATION_FLAG" ]; then printf "1:3:81a4:20:0:0:644\\n"; else printf "1:2:81a4:20:0:0:644\\n"; fi;; esac\n'
    );
    await writeFile(
      join(bin, 'findmnt'),
      '#!/bin/sh\nprintf "/ fixture tmpfs ro\\n"\n'
    );
    await writeFile(
      join(bin, 'sha256sum'),
      '#!/bin/sh\n/usr/bin/shasum -a 256 "$@"; status=$?; if [ "$1" = "$RETIRE_OLLAMA_MUTATION_TARGET" ] && [ ! -e "$RETIRE_OLLAMA_MUTATION_FLAG" ]; then printf "OLLAMA_HOST=https://example.invalid\\n" >"$RETIRE_OLLAMA_MUTATION_TARGET"; : >"$RETIRE_OLLAMA_MUTATION_FLAG"; fi; exit "$status"\n'
    );
    await Promise.all(
      ['readlink', 'stat', 'findmnt', 'sha256sum'].map((name) =>
        chmod(join(bin, name), 0o755)
      )
    );
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          '. "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; RECOVERY_RECORDS="[]"; deps="[]"; init_temp_root; trap cleanup_temp EXIT; recovery_record_environment "$2" 0',
          'recovery-final-reference-test',
          script.pathname,
          environment,
        ],
        {
          env: {
            ...process.env,
            RETIRE_OLLAMA_TEST_BIN: bin,
            RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
            RETIRE_OLLAMA_MUTATION_FLAG: mutationFlag,
            RETIRE_OLLAMA_MUTATION_TARGET: environment,
          },
          ...(process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {}),
        }
      ),
      (error) =>
        error.code === 78 &&
        /recovery reference changed during capture/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
