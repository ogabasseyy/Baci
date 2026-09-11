import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('counts directory entries against the bind snapshot limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-bind-directory-limit-'));
  const source = join(root, 'tree');
  await mkdir(source);
  const command = `. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_temp_root_helper; temp_root_required_bytes() { printf '1\\n'; }; init_temp_root; trap cleanup_temp EXIT; load_consumer_scanners; bind_scan_root="$3"; readlink() { [ "$1" = -f ] && printf '%s\\n' "$2" || /usr/bin/readlink "$@"; }; stat() { case "$2" in %d) printf '1\\n';; %F) printf 'directory\\n';; *) printf '1:2:41ed:0:0:700\\n';; esac; }; find() { printf '%s\\0' "$bind_scan_root"; index=0; while [ "$index" -lt 4096 ]; do printf '%s/directory-%s\\0' "$bind_scan_root" "$index"; index=$((index + 1)); done; }; output=$(temp_path); container_bind_directory_snapshot "$bind_scan_root" "$output"`;
  try {
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          command,
          'bind-directory-limit-test',
          script.pathname,
          root,
          source,
        ],
        {
          env: {
            ...process.env,
            RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
            RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
          },
        }
      ),
      (error) => error.code === 2
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
