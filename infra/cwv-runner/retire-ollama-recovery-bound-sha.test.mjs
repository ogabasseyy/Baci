import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const retireScript = new URL('./retire-ollama.sh', import.meta.url);
const execFileAsync = promisify(execFile);

test('recovery_bound_sha rejects a pathname timestamp race after descriptor read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-recovery-bound-sha-race-'));
  const source = join(root, 'source.sh');
  const hook = join(root, 'RecoveryBoundRace.pm');
  const command = (boundSource) =>
    execFileAsync(
      'sh',
      [
        '-c',
        `. "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; RETIRE_OLLAMA_TEST_FSTYPE=apfs; init_temp_root; trap cleanup_temp EXIT; ${boundSource}`,
        'recovery-bound-sha-race',
        retireScript.pathname,
        source,
      ],
      { env: { ...process.env, RETIRE_OLLAMA_TEST_BIN: '/usr/bin' } }
    );
  try {
    await writeFile(source, '#!/bin/sh\nprintf stable\n', { mode: 0o600 });
    await chmod(source, 0o600);
    await writeFile(
      hook,
      'package RecoveryBoundRace; use strict; use warnings; sub import { no strict "refs"; my $calls = 0; *CORE::GLOBAL::lstat = sub { my ($path) = @_; $calls++; if ($calls == 2) { utime(time + 1, time + 1, $path) == 1 or die "utime failed"; } return CORE::lstat($path); }; } 1;\n'
    );
    const control = await command(
      'sha() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk "{print \\$1}"; }; recovery_bound_sha "$2"'
    );
    assert.match(control.stdout.trim(), /^[0-9a-f]{64}$/);
    await assert.rejects(
      command(
        'sha() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk "{print \\$1}"; }; PERL5OPT="-M' +
          hook.slice(0, -3) +
          '" recovery_bound_sha "$2"'
      ),
      (error) => error.code === 1
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
