import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  chown,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const runnerDir = new URL('.', import.meta.url);
const childIdentity =
  process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'baci-source-loader-private-'));
  const sourceDir = join(root, 'sealed-source');
  const source = join(sourceDir, 'helper.sh');
  const tempRoot = join(root, 'private-temp');
  const main = join(root, 'retire-ollama.sh');
  await Promise.all([mkdir(sourceDir), mkdir(tempRoot)]);
  await writeFile(source, 'SOURCE_EVENTS=private-root\n');
  await chmod(root, 0o755);
  await chmod(sourceDir, 0o555);
  await chmod(source, 0o444);
  await chmod(tempRoot, 0o700);
  await copyFile(new URL('./retire-ollama.sh', runnerDir), main);
  await chmod(main, 0o555);
  if (childIdentity.uid !== undefined && childIdentity.gid !== undefined) {
    await chown(tempRoot, childIdentity.uid, childIdentity.gid);
  }
  return { root, source, sourceDir, tempRoot, main };
}

async function runLoader(loader, source, tempRoot) {
  const command = [
    '. "$1"',
    'TEMP_ROOT="$3"',
    'temp_root_verify_root() { [ -d "$TEMP_ROOT" ] && [ ! -L "$TEMP_ROOT" ]; }',
    'source_loader_source "$2"',
    'printf "%s\\n" "$SOURCE_EVENTS"',
  ].join('\n');
  const { stdout } = await execFileAsync(
    'sh',
    [
      '-c',
      command,
      'source-loader-private-root-test',
      loader,
      source,
      tempRoot,
    ],
    {
      ...childIdentity,
      env: { ...process.env, RETIRE_OLLAMA_TEST_BIN: '/usr/bin' },
    }
  );
  return stdout;
}

test('snapshots into the validated private temp root after dropping to 65534', async () => {
  const fixtureState = await fixture();
  try {
    const externalLoader = join(
      fixtureState.root,
      'retire-ollama-source-loader.sh'
    );
    await copyFile(
      new URL('./retire-ollama-source-loader.sh', runnerDir),
      externalLoader
    );
    await chmod(externalLoader, 0o555);
    const [external, inline] = await Promise.all([
      runLoader(externalLoader, fixtureState.source, fixtureState.tempRoot),
      runLoader(fixtureState.main, fixtureState.source, fixtureState.tempRoot),
    ]);
    assert.equal(external, 'private-root\n');
    assert.equal(inline, external);
    assert.deepEqual(
      (await readdir(fixtureState.sourceDir)).filter((name) =>
        name.startsWith('.retire-ollama-source.')
      ),
      []
    );
    assert.deepEqual(
      (await readdir(fixtureState.tempRoot)).filter((name) =>
        name.startsWith('.retire-ollama-source.')
      ),
      []
    );
  } finally {
    await chmod(fixtureState.sourceDir, 0o755);
    await rm(fixtureState.root, { force: true, recursive: true });
  }
});
