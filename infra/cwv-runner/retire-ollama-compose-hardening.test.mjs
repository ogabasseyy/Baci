import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  chown,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const unprivileged = process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
async function stageHelpers(directory) {
  const staged = join(directory, 'helpers');
  await mkdir(staged, { mode: 0o755 });
  const helperNames = (await readdir(new URL('.', import.meta.url))).filter(
    (name) =>
      (name === 'retire-ollama.sh' || name.startsWith('retire-ollama-')) &&
      name.endsWith('.sh')
  );
  await Promise.all(
    helperNames.map(async (name) => {
      await copyFile(new URL(`./${name}`, import.meta.url), join(staged, name));
      await chmod(join(staged, name), 0o755);
    })
  );
  if (unprivileged.uid !== undefined && unprivileged.gid !== undefined)
    await chown(staged, unprivileged.uid, unprivileged.gid);
  return staged;
}

test('classifies a Compose consumer through the unprivileged test-only loader', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-compose-yaml-'));
  const compose = join(directory, 'compose.yaml');
  const receipt = join(directory, 'receipt.json');
  const staged = await stageHelpers(directory);
  try {
    await writeFile(
      compose,
      'services:\n  app:\n    environment: [OLLAMA_HOST=http://127.0.0.1:11434]\n'
    );
    await writeFile(receipt, '');
    await Promise.all([
      chmod(directory, 0o755),
      chmod(compose, 0o644),
      chmod(receipt, 0o666),
    ]);
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          'helper="$3/retire-ollama-consumers.sh"; copy=$(mktemp); sed \'$d\' "$1" >"$copy"; RETIRE_OLLAMA_CONSUMER_SCANNER_HELPER="$helper"; . "$copy"; SCRIPT_DIR=$3; rm -f "$copy"; stat() { printf "1:2:81a4:10:501:20:644\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; readlink() { for path do :; done; printf "%s\\n" "$path"; }; COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; consumer_counts=$(jq -cn \'["systemd-definitions","reverse-proxy","running-processes","running-containers","container-definitions","container-config"] | map({surface:.,matchCount:0})\'); out=$(temp_path); scan_compose_definitions >"$out"; record_consumers compose-definitions "$out" all; jq -n --argjson counts "$consumer_counts" \'{scan:{consumerCounts:$counts}}\' >"$4"; RECEIPT="$4"; assert_zero_consumers',
          'retire-compose-test',
          join(staged, 'retire-ollama.sh'),
          directory,
          staged,
          receipt,
        ],
        {
          ...unprivileged,
          env: { ...process.env, RETIRE_OLLAMA_TEST_BIN: process.env.PATH },
        }
      ),
      (error) =>
        error.code === 78 && /zero classified consumers/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not apply a relative Compose base to the following absolute env_file', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-compose-path-order-'))
  );
  const composeRoot = join(directory, 'compose');
  const compose = join(composeRoot, 'compose.yaml');
  const relative = join(composeRoot, 'relative.env');
  const absolute = join(directory, 'absolute.env');
  try {
    await mkdir(composeRoot);
    await writeFile(
      compose,
      `services:\n  relative:\n    env_file: ./relative.env\n  absolute:\n    env_file: ${absolute}\n`
    );
    await Promise.all([
      writeFile(relative, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
      writeFile(absolute, 'OLLAMA_HOST=http://127.0.0.1:11434\n'),
    ]);
    await Promise.all([
      chmod(directory, 0o755),
      chmod(composeRoot, 0o755),
      chmod(compose, 0o644),
      chmod(relative, 0o644),
      chmod(absolute, 0o644),
    ]);
    const { stdout } = await execFileAsync('sh', [
      '-c',
      'stat() { printf "1:2:81a4:10:501:20:644\\n"; }; findmnt() { printf "/ fixture apfs ro\\n"; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); COMPOSE_ROOTS="$2"; init_temp_root; trap cleanup_temp EXIT; scan_compose_definitions',
      'retire-ollama-compose-path-order-test',
      script.pathname,
      composeRoot,
    ]);
    assert.match(
      stdout,
      new RegExp(`\\|${relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`)
    );
    assert.match(
      stdout,
      new RegExp(`\\|${absolute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
