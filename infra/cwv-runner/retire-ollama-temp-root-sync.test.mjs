import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-temp-root.sh', import.meta.url);

test('Darwin sync support avoids the unsupported path argument', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-temp-root-sync-'));
  const marker = join(directory, 'sync-arguments');
  try {
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        'uname() { printf Darwin; }; . "$1"; temp_root_test_mode() { return 0; }; temp_root_sync_command() { printf "%s" "$*" >"$RETIRE_OLLAMA_SYNC_ARGUMENTS"; }; temp_root_sync "$2"; [ ! -s "$RETIRE_OLLAMA_SYNC_ARGUMENTS" ] && printf darwin-supported',
        'temp-root-darwin-sync-test',
        helper.pathname,
        directory,
      ],
      { env: { ...process.env, RETIRE_OLLAMA_SYNC_ARGUMENTS: marker } }
    );
    assert.equal(stdout, 'darwin-supported');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
