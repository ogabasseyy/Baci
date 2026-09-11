import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('classifies marker-bearing named-volume paths even when their bytes are clean', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-volume-marker-'));
  const volume = join(root, 'volume');
  const bin = join(root, 'bin');
  await mkdir(bin);
  await mkdir(volume);
  await writeFile(join(volume, 'ollama-settings.conf'), 'SETTING=enabled\n');
  await writeFile(
    join(bin, 'stat'),
    '#!/bin/sh\nif [ "$1" = -c ]; then case "$2" in %s) exec /usr/bin/stat -f %z -- "$3";; %d) exec /usr/bin/stat -f %d -- "$3";; %F) [ -d "$3" ] && printf "directory\\n" || printf "regular file\\n"; exit;; %d:%i:%f:%s:%u:%g:%a) exec /usr/bin/perl -e \'@s=stat($ARGV[0]); printf "%s:%s:%x:%s:%s:%s:%o\\n",$s[0],$s[1],$s[2],$s[7],$s[4],$s[5],$s[2]&07777\' "$3";; esac; fi; exec /usr/bin/stat "$@"\n',
    { mode: 0o700 }
  );
  await chmod(join(bin, 'stat'), 0o700);
  await writeFile(
    join(bin, 'findmnt'),
    '#!/bin/sh\nprintf "/ fixture apfs ro\\n"\n',
    { mode: 0o700 }
  );
  await chmod(join(bin, 'findmnt'), 0o700);
  const command = `sha256sum() { /usr/bin/shasum -a 256 "$@"; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; volume_root=$(readlink -f -- "$3"); init_temp_root; trap cleanup_temp EXIT; load_consumer_scanners; CANONICAL_DOCKER_SOCKET=/run/docker.sock; docker() { printf '%s\\n' '{"Name":"model-cache","Driver":"local","Mountpoint":"'$volume_root'","Scope":"local"}'; }; container_volume_consumers container-id model-cache "$volume_root" /cache`;
  try {
    const { stdout } = await execFileAsync(
      'sh',
      ['-c', command, 'volume-marker-test', script.pathname, root, volume],
      {
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: bin,
          RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        },
      }
    );
    assert.match(stdout, /^container-volume:/m);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('rejects a named volume whose stable file stops matching between scans', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-volume-match-state-'));
  const command = `. "$1"; SCRIPT_DIR=$(dirname "$1"); fixture_root="$2"; temp_path() { mktemp "$fixture_root/temp.XXXXXX"; }; load_consumer_scanners; counter="$fixture_root/matches"; printf '0\\n' >"$counter"; container_volume_metadata() { printf 'stable-metadata\\n'; }; container_volume_files() { printf '/volume/config\\n'; }; consumer_file_fingerprint() { printf '%s|content|identity\\n' "$1"; }; consumer_matched_fingerprint() { count=$(cat "$counter"); count=$((count + 1)); printf '%s\\n' "$count" >"$counter"; [ "$count" -eq 1 ] || return 1; printf '%s|content|identity\\n' "$1"; }; if container_volume_consumers container-id model-cache /volume /cache >/dev/null; then exit 1; else status=$?; fi; [ "$status" -eq 2 ]`;
  try {
    await execFileAsync(
      'sh',
      ['-c', command, 'volume-match-state-test', script.pathname, root],
      { env: { ...process.env, RETIRE_OLLAMA_TEST_FSTYPE: 'apfs' } }
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
