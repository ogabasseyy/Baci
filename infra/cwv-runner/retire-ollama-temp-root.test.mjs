import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const tempRootHelper = new URL('./retire-ollama-temp-root.sh', import.meta.url);

async function fixture(dfOutput, fstype) {
  const directory = await mkdtemp(join(tmpdir(), 'baci-temp-root-'));
  const bin = join(directory, 'bin');
  await execFileAsync('mkdir', ['-p', bin]);
  await writeFile(
    join(bin, 'df'),
    `#!/bin/sh\nprintf '%s\\n%s\\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on' '${dfOutput}'\n`
  );
  await chmod(join(bin, 'df'), 0o755);
  await writeFile(
    join(bin, 'sync'),
    '#!/bin/sh\n: >"$RETIRE_OLLAMA_SYNC_MARKER"\nexit 99\n'
  );
  await chmod(join(bin, 'sync'), 0o755);
  return {
    directory,
    env: {
      ...process.env,
      RETIRE_OLLAMA_TMPDIR: directory,
      RETIRE_OLLAMA_TEST_BIN: bin,
      RETIRE_OLLAMA_TEST_FSTYPE: fstype,
    },
  };
}

test('rejects a tmpfs temporary parent before creating a temporary directory', async () => {
  const fixtureValue = await fixture('fixture 1 1 6000000 1% /tmp', 'tmpfs');
  try {
    await assert.rejects(
      execFileAsync(
        'sh',
        ['-c', `. "$1"; init_temp_root`, 'temp-root-test', script.pathname],
        {
          env: fixtureValue.env,
        }
      ),
      (error) => error.code === 65 && /disk-backed/.test(error.stderr)
    );
  } finally {
    await rm(fixtureValue.directory, { recursive: true, force: true });
  }
});

test('rejects insufficient free space for both retained archives and overhead', async () => {
  const fixtureValue = await fixture('fixture 1 1 1024 1% /tmp', 'ext4');
  try {
    await assert.rejects(
      execFileAsync(
        'sh',
        ['-c', `. "$1"; init_temp_root`, 'temp-root-test', script.pathname],
        {
          env: fixtureValue.env,
        }
      ),
      (error) =>
        error.code === 65 &&
        /insufficient temporary parent free space/.test(error.stderr)
    );
  } finally {
    await rm(fixtureValue.directory, { recursive: true, force: true });
  }
});

test('accepts disk-backed storage with the required free-space bound', async () => {
  const fixtureValue = await fixture('fixture 1 1 6000000 1% /tmp', 'ext4');
  try {
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `. "$1"; init_temp_root; [ -d "$TEMP_ROOT" ]; printf accepted`,
        'temp-root-test',
        script.pathname,
      ],
      { env: fixtureValue.env }
    );
    assert.equal(stdout, 'accepted');
  } finally {
    await rm(fixtureValue.directory, { recursive: true, force: true });
  }
});

test('formats large available-byte counts as exact decimal integers', async () => {
  const fixtureValue = await fixture(
    'fixture 1 1 9007199254740991 1% /tmp',
    'ext4'
  );
  try {
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `PATH="$RETIRE_OLLAMA_TEST_BIN:/usr/bin:/bin"; export PATH; . "$1"; temp_root_available_bytes "$2"`,
        'temp-root-available-bytes-format-test',
        tempRootHelper.pathname,
        fixtureValue.directory,
      ],
      { env: fixtureValue.env }
    );
    assert.equal(stdout, '9223372036854774784\n');
  } finally {
    await rm(fixtureValue.directory, { recursive: true, force: true });
  }
});

test('rejects a parent mount remount observed after temporary-directory creation', async () => {
  const fixtureValue = await fixture('fixture 1 1 6000000 1% /tmp', '');
  try {
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          'PATH="$RETIRE_OLLAMA_TEST_BIN:/usr/bin:/bin"; export PATH; die() { printf "%s\\n" "$1" >&2; exit 65; }; marker="$RETIRE_OLLAMA_TMPDIR/findmnt-calls"; : >"$marker"; findmnt() { calls=$(cat "$marker"); calls=$((calls + 1)); printf "%s" "$calls" >"$marker"; if [ "$calls" -le 2 ]; then printf "/ fixture ext4 rw\\n"; else printf "/substituted fixture ext4 rw\\n"; fi; }; . "$1"; _init_temp_root',
          'temp-root-mount-substitution-test',
          new URL('./retire-ollama-temp-root.sh', import.meta.url).pathname,
        ],
        { env: { ...fixtureValue.env, RETIRE_OLLAMA_TEST_FSTYPE: '' } }
      ),
      (error) =>
        error.code === 65 &&
        /temporary storage changed during creation/.test(error.stderr)
    );
  } finally {
    await rm(fixtureValue.directory, { recursive: true, force: true });
  }
});

test('revalidates the recorded temporary root inode before every temporary path', async () => {
  const fixtureValue = await fixture('fixture 1 1 6000000 1% /tmp', 'ext4');
  try {
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          'PATH="$RETIRE_OLLAMA_TEST_BIN:/usr/bin:/bin"; export PATH; die() { printf "%s\\n" "$1" >&2; exit 65; }; . "$1"; _init_temp_root; old=$TEMP_ROOT; mv "$old" "$old.real"; mkdir "$old"; chmod 0700 "$old"; _temp_path',
          'temp-root-inode-substitution-test',
          new URL('./retire-ollama-temp-root.sh', import.meta.url).pathname,
        ],
        { env: fixtureValue.env }
      ),
      (error) =>
        error.code === 65 && /temporary storage changed/.test(error.stderr)
    );
  } finally {
    await rm(fixtureValue.directory, { recursive: true, force: true });
  }
});

test('cleanup never deletes a replacement at the recorded temporary-root path', async () => {
  const fixtureValue = await fixture('fixture 1 1 6000000 1% /tmp', 'ext4');
  try {
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        'PATH="$RETIRE_OLLAMA_TEST_BIN:/usr/bin:/bin"; export PATH; . "$1"; _init_temp_root; old=$TEMP_ROOT; mv "$old" "$old.original"; mkdir "$old"; chmod 0700 "$old"; _cleanup_temp; [ -d "$old" ] && [ -d "$old.original" ]; printf preserved',
        'temp-root-cleanup-race-test',
        new URL('./retire-ollama-temp-root.sh', import.meta.url).pathname,
      ],
      { env: fixtureValue.env }
    );
    assert.equal(stdout, 'preserved');
  } finally {
    await rm(fixtureValue.directory, { recursive: true, force: true });
  }
});

test('cleanup bypasses a hostile sibling preclaim of the predictable quarantine name', async () => {
  const fixtureValue = await fixture('fixture 1 1 6000000 1% /tmp', 'ext4');
  await chmod(fixtureValue.directory, 0o1777);
  try {
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        'PATH="$RETIRE_OLLAMA_TEST_BIN:/usr/bin:/bin"; export PATH; . "$1"; _init_temp_root; old=$TEMP_ROOT; : >"$old/original-marker"; hostile_quarantine="$old.cleanup.$$"; /bin/mkdir "$hostile_quarantine"; : >"$hostile_quarantine/attacker-marker"; _cleanup_temp; [ ! -e "$old" ] && [ -f "$hostile_quarantine/attacker-marker" ] || exit 1; printf cleaned',
        'temp-root-cleanup-quarantine-race-test',
        new URL('./retire-ollama-temp-root.sh', import.meta.url).pathname,
      ],
      { env: fixtureValue.env }
    );
    assert.equal(stdout, 'cleaned');
  } finally {
    await rm(fixtureValue.directory, { recursive: true, force: true });
  }
});

test('rejects a non-sticky writable temporary parent', async () => {
  const fixtureValue = await fixture('fixture 1 1 6000000 1% /tmp', 'ext4');
  await chmod(fixtureValue.directory, 0o777);
  try {
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          `. "$1"; init_temp_root`,
          'temp-root-mode-test',
          script.pathname,
        ],
        { env: fixtureValue.env }
      ),
      (error) => error.code === 65 && /private or sticky/.test(error.stderr)
    );
  } finally {
    await rm(fixtureValue.directory, { recursive: true, force: true });
  }
});

test('does not enter temporary-root test mode from an unprivileged uid alone', async () => {
  const env = { ...process.env, RETIRE_OLLAMA_TEST_FSTYPE: 'ext4' };
  delete env.RETIRE_OLLAMA_TEST_BIN;
  const { stdout } = await execFileAsync(
    'sh',
    [
      '-c',
      '. "$1"; if temp_root_test_mode; then printf test; else printf production; fi',
      'temp-root-test-mode-gate',
      new URL('./retire-ollama-temp-root.sh', import.meta.url).pathname,
    ],
    { env }
  );
  assert.equal(stdout, 'production');
});

test('fsync ignores PATH-selected sync and uses the unprivileged test fallback', async () => {
  const fixtureValue = await fixture('fixture 1 1 6000000 1% /tmp', 'ext4');
  const marker = join(fixtureValue.directory, 'path-sync-used');
  const target = join(fixtureValue.directory, 'sync-target');
  try {
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        'PATH="$RETIRE_OLLAMA_TEST_BIN:/usr/bin:/bin"; export PATH RETIRE_OLLAMA_SYNC_MARKER; . "$1"; die() { printf "%s\\n" "$1" >&2; exit 65; }; : >"$2"; _fsync_file "$2"; _fsync_dir "$(dirname "$2")"; [ ! -e "$RETIRE_OLLAMA_SYNC_MARKER" ] || exit 1; printf fallback',
        'temp-root-fsync-path-test',
        tempRootHelper.pathname,
        target,
      ],
      { env: { ...fixtureValue.env, RETIRE_OLLAMA_SYNC_MARKER: marker } }
    );
    assert.equal(stdout, 'fallback');
  } finally {
    await rm(fixtureValue.directory, { recursive: true, force: true });
  }
});

test('temporary-root creation ignores PATH-selected mktemp and chmod', async () => {
  const fixtureValue = await fixture('fixture 1 1 6000000 1% /tmp', 'ext4');
  const mktempMarker = join(fixtureValue.directory, 'path-mktemp-used');
  const chmodMarker = join(fixtureValue.directory, 'path-chmod-used');
  await writeFile(
    join(fixtureValue.directory, 'bin', 'mktemp'),
    '#!/bin/sh\n: >"$RETIRE_OLLAMA_MKTEMP_MARKER"\nexit 99\n'
  );
  await chmod(join(fixtureValue.directory, 'bin', 'mktemp'), 0o755);
  await writeFile(
    join(fixtureValue.directory, 'bin', 'chmod'),
    '#!/bin/sh\n: >"$RETIRE_OLLAMA_CHMOD_MARKER"\nexit 99\n'
  );
  await chmod(join(fixtureValue.directory, 'bin', 'chmod'), 0o755);
  try {
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        'PATH="$RETIRE_OLLAMA_TEST_BIN:/usr/bin:/bin"; export PATH RETIRE_OLLAMA_MKTEMP_MARKER RETIRE_OLLAMA_CHMOD_MARKER; die() { printf "%s\\n" "$1" >&2; exit 65; }; . "$1"; _init_temp_root; _temp_path >/dev/null; [ ! -e "$RETIRE_OLLAMA_MKTEMP_MARKER" ] && [ ! -e "$RETIRE_OLLAMA_CHMOD_MARKER" ] || exit 1; printf pinned',
        'temp-root-creation-path-test',
        tempRootHelper.pathname,
      ],
      {
        env: {
          ...fixtureValue.env,
          RETIRE_OLLAMA_MKTEMP_MARKER: mktempMarker,
          RETIRE_OLLAMA_CHMOD_MARKER: chmodMarker,
        },
      }
    );
    assert.equal(stdout, 'pinned');
  } finally {
    await rm(fixtureValue.directory, { recursive: true, force: true });
  }
});
