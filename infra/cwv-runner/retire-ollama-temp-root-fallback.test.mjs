import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const sourceScript = new URL('./retire-ollama.sh', import.meta.url);
const sourceHelper = new URL('./retire-ollama-temp-root.sh', import.meta.url);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'baci-temp-root-fallback-'));
  const scriptDir = join(root, 'script');
  const cwdHelper = join(root, 'infra', 'cwv-runner');
  await Promise.all([
    mkdir(scriptDir, { mode: 0o777, recursive: true }),
    mkdir(cwdHelper, { mode: 0o777, recursive: true }),
  ]);
  const scriptPath = join(scriptDir, 'retire-ollama.sh');
  const scriptText = (await readFile(sourceScript, 'utf8')).replaceAll(
    '/usr/bin/id -u',
    'id -u'
  );
  await writeFile(scriptPath, scriptText);
  await copyFile(sourceHelper, join(cwdHelper, 'retire-ollama-temp-root.sh'));
  await chmod(join(scriptDir, 'retire-ollama.sh'), 0o755);
  await chmod(join(cwdHelper, 'retire-ollama-temp-root.sh'), 0o644);
  return { root, script: scriptPath };
}

function run(script, root, testMode) {
  const testBin = testMode ? 'export RETIRE_OLLAMA_TEST_BIN=/usr/bin; ' : '';
  return execFileAsync(
    'sh',
    [
      '-c',
      `id() { printf '65534\\n'; }; ${testBin}. "$1"; load_temp_root_helper; printf "%s\\n" "$TEMP_ROOT_HELPER_LOADED"`,
      'temp-root-fallback-test',
      script,
    ],
    { cwd: root }
  );
}

test('rejects cwd temp-root fallback outside the explicit test harness', async () => {
  const { root, script } = await fixture();
  try {
    await assert.rejects(
      run(script, root, false),
      (error) => error.code === 65
    );
    const { stdout } = await run(script, root, true);
    assert.equal(stdout.trim(), 'yes');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

assert.ok(sourceScript.pathname.endsWith('retire-ollama.sh'));
