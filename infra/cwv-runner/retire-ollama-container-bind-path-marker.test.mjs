import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('records a marker-bearing regular bind path with generic bytes', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-container-bind-marker-path-'))
  );
  try {
    const source = join(directory, 'source');
    await mkdir(source);
    await writeFile(
      join(source, 'ollama-runtime.conf'),
      'generic configuration bytes\n'
    );
    const { stdout } = await execFileAsync('sh', [
      '-c',
      `sha256sum() { /usr/bin/shasum -a 256 "$@"; }
stat() { for last do :; done; case "$*" in *'-c %F'*) [ -d "$last" ] && printf 'directory\\n' || printf 'regular file\\n';; *'-c %d:%i:%f:%s:%u:%g:%a'*) printf '1:2:81a4:10:0:0:600\\n';; *'-c %d'*) printf '1\\n';; *'-c %s'*) wc -c <"$last" | tr -d ' ';; *) printf '1:2:81a4:10:0:0:600\\n';; esac; }
findmnt() { printf '/ fixture apfs ro\\n'; }
. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_temp_root_helper; temp_root_required_bytes() { printf '1\\n'; }; init_temp_root; trap cleanup_temp EXIT HUP INT TERM; load_consumer_scanners; set +e; output=$(container_bind_directory_consumers generic-api "$3" /etc/application); status=$?; set -e; [ "$status" -eq 0 ] || exit "$status"; printf '%s\\n' "$output"`,
      'retire-ollama-container-bind-marker-path-test',
      script.pathname,
      directory,
      source,
    ]);
    assert.match(
      stdout,
      /^container-bind-directory-path:[a-f0-9]{64}:[a-f0-9]{64}\|[a-f0-9]{64}\n?$/
    );
    assert.doesNotMatch(stdout, /ollama-runtime\.conf|generic configuration/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
