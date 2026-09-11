import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
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
const unprivileged = process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};

async function fixtureDirectory() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-cron-recovery-'))
  );
  await chmod(directory, 0o777);
  return directory;
}

function recoveryShell(command, args = []) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `sha256sum() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$@"; else command sha256sum "$@"; fi; }; stat() { printf '1:2:81a4:10:65534:65534:600\\n'; }; findmnt() { printf '/ fixture tmpfs rw\\n'; }; . "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; init_temp_root; trap cleanup_temp EXIT; ${command}`,
      'retire-ollama-cron-recovery-fixture-test',
      script.pathname,
      ...args,
    ],
    {
      ...unprivileged,
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
      },
    }
  );
}

test('recovery classifies the retained snapshot after its deprivileged fixture mutation', async () => {
  const directory = await fixtureDirectory();
  const cron = join(directory, 'crontab');
  const manifest = join(directory, 'manifest');
  try {
    await writeFile(cron, '0 * * * * /usr/bin/other\n');
    await chmod(cron, 0o666);
    await writeFile(manifest, `system\t-\t${cron}\n`);
    const { stdout } = await recoveryShell(
      `RECOVERY_EXTERNAL_CRON_SOURCES="$2"; RECOVERY_RECORDS='[]'; recovery_record_path() { snapshot=$(temp_path); cat "$2" >"$snapshot"; printf '%s\\n' '0 * * * * /usr/bin/ollama serve' >"$2" || die 'fixture mutation failed'; RECOVERY_REFERENCE_SNAPSHOT=$snapshot; }; recovery_surface() { class=$1; shift; [ "$class" = system-crontab ] && [ "$("$@")" = '0 * * * * /usr/bin/other' ] || die 'recovery cron did not use retained snapshot'; }; load_cron_inventory_helper() { :; }; cron_inventory_record_wrapper_consumers() { :; }; recovery_record_external_cron_sources; printf retained`,
      [manifest, cron]
    );
    assert.equal(stdout, 'retained');
    assert.equal(
      await readFile(cron, 'utf8'),
      '0 * * * * /usr/bin/ollama serve\n'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('recovery traverses cron wrapper targets through the retained source snapshot', async () => {
  const directory = await fixtureDirectory();
  const cron = join(directory, 'crontab');
  const manifest = join(directory, 'manifest');
  try {
    await writeFile(cron, '0 * * * * root /srv/cwv-wrapper\n');
    await writeFile(manifest, `system\t-\t${cron}\n`);
    const { stdout } = await recoveryShell(
      `RECOVERY_EXTERNAL_CRON_SOURCES="$2"; RECOVERY_RECORDS='[]'; recovery_record_path() { snapshot=$(temp_path); cat "$2" >"$snapshot"; RETAINED=$snapshot; RECOVERY_REFERENCE_SNAPSHOT=$snapshot; }; recovery_surface() { class=$1; shift; [ "$class" = system-crontab ] && [ "$("$@")" = '0 * * * * root /srv/cwv-wrapper' ] || die 'recovery cron did not use retained snapshot'; }; load_cron_inventory_helper() { :; }; cron_inventory_record_wrapper_consumers() { [ "$4" = "$RETAINED" ] || die 'wrapper did not receive retained snapshot'; records=$(jq -cn --argjson old "$records" --arg class "$1-command" '$old + [{class:$class}]'); }; recovery_record_external_cron_sources; printf '%s\\n' "$RECOVERY_RECORDS"`,
      [manifest, cron]
    );
    assert.deepEqual(JSON.parse(stdout), [{ class: 'system-crontab-command' }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
