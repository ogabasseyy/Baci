import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('does not reapply the initial reserve after retained archive space is consumed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-temp-root-reserve-'));
  const bin = join(directory, 'bin');
  await execFileAsync('mkdir', ['-p', bin]);
  await writeFile(
    join(bin, 'df'),
    `#!/bin/sh
calls_file="$RETIRE_OLLAMA_TMPDIR/df-calls"
calls=$(cat "$calls_file" 2>/dev/null || printf 0)
calls=$((calls + 1))
printf '%s' "$calls" >"$calls_file"
if [ "$calls" -le 2 ]; then
  available=6000000
else
  available=4500000
fi
printf '%s\\n%s\\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on' "fixture 1 1 $available 1% /tmp"
`
  );
  await chmod(join(bin, 'df'), 0o755);
  try {
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `. "$1"; init_temp_root; _temp_path >/dev/null; printf accepted`,
        'temp-root-retained-reserve-test',
        script.pathname,
      ],
      {
        env: {
          ...process.env,
          RETIRE_OLLAMA_TMPDIR: directory,
          RETIRE_OLLAMA_TEST_BIN: bin,
          RETIRE_OLLAMA_TEST_FSTYPE: 'ext4',
        },
      }
    );
    assert.equal(stdout, 'accepted');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
