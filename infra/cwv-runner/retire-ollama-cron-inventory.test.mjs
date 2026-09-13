import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const unprivileged = process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
const absentCronSources = {
  RETIRE_OLLAMA_ANACRONTAB: '/__baci_test_absent_anacrontab',
  RETIRE_OLLAMA_CRON_HOURLY_DIR: '/__baci_test_absent_cron_hourly',
  RETIRE_OLLAMA_CRON_DAILY_DIR: '/__baci_test_absent_cron_daily',
  RETIRE_OLLAMA_CRON_WEEKLY_DIR: '/__baci_test_absent_cron_weekly',
  RETIRE_OLLAMA_CRON_MONTHLY_DIR: '/__baci_test_absent_cron_monthly',
};

async function fixtureDirectory(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await chmod(directory, 0o777);
  return directory;
}

function shell(command, args = [], env = {}) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT; ${command}`,
      'retire-ollama-cron-inventory-test',
      script.pathname,
      ...args,
    ],
    {
      ...unprivileged,
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
        ...absentCronSources,
        ...env,
      },
    }
  );
}

function fixtureFunctions() {
  return `sha256sum() { /usr/bin/shasum -a 256 "$@"; }
readlink() { for path do :; done; printf '%s\\n' "$path"; }
stat() { format=; for arg do case "$arg" in -c) next=1;; *) if [ "\${next:-0}" = 1 ]; then format=$arg; next=0; fi;; esac; done; for path do :; done; case "$path" in */crontabs) owner=0; gid="\${CRON_SPOOL_GID:-123}"; mode=1730;; */cron.d) owner=0; gid=0; mode=755;; */etc/crontab|*/cron.d/*) owner=0; gid=0; mode=644;; */crontabs/root|*/crontabs/worker) owner=0; gid=123; mode=600;; */crontabs/bassey) owner=1000; gid=123; mode=600;; *) owner=0; gid=0; mode=600;; esac; case "$format" in *%g*) printf '%s:%s:%s\\n' "$owner" "$gid" "$mode";; *) printf '%s:%s\\n' "$owner" "$mode";; esac; }
getent() { case "$1:$2" in group:crontab) printf 'crontab:x:123:'; [ "\${GETENT_MULTI_GROUP:-0}" = 1 ] && printf '\\ncrontab:x:123:'; printf '\\n';; passwd:root) printf 'root:x:0:0::/:/bin/sh\\n';; passwd:worker) printf 'worker:x:2001:2001::/:/bin/sh'; [ "\${GETENT_MULTI_USER:-0}" = 1 ] && printf '\\nworker:x:2001:2001::/:/bin/sh'; printf '\\n';; passwd:bassey) printf 'bassey:x:1000:1000::/:/bin/sh\\n';; *) return 2;; esac; }`;
}

test('runs cron inventory fixtures without root authority', async () => {
  const { stdout } = await shell('id -u');
  assert.notEqual(stdout.trim(), '0');
});

test('does not cache a cron helper before its receipt digest binding succeeds', async () => {
  const { stdout } = await shell(
    `died=0; die() { died=$((died + 1)); }; source_loader_source() { SOURCE_LOADER_DIGEST=actual; }; RECOVERY_CRON_INVENTORY_SHA=expected; unset CRON_INVENTORY_HELPER_SHA; load_cron_inventory_helper || :; if [ "\${CRON_INVENTORY_HELPER_SHA+x}" = x ]; then printf cached; else printf uncached; fi; printf '|die=%s' "$died"`
  );
  assert.equal(stdout, 'uncached|die=1');
});

test('binds system, root, and other-user cron sources while excluding owner spool duplication', async () => {
  const directory = await fixtureDirectory('baci-cron-inventory-');
  const system = join(directory, 'etc', 'crontab');
  const systemDir = join(directory, 'etc', 'cron.d');
  const spool = join(directory, 'spool', 'crontabs');
  const manifest = join(directory, 'manifest');
  try {
    await mkdir(systemDir, { recursive: true });
    await mkdir(spool, { recursive: true });
    await Promise.all([
      writeFile(system, '0 * * * * /usr/bin/ollama serve\n'),
      writeFile(join(systemDir, 'cleanup'), '0 * * * * /usr/bin/other\n'),
      writeFile(join(spool, 'root'), '0 * * * * /usr/bin/ollama serve\n'),
      writeFile(join(spool, 'worker'), '0 * * * * /usr/bin/ollama serve\n'),
      writeFile(join(spool, 'bassey'), '0 * * * * /usr/bin/ollama serve\n'),
    ]);
    const { stdout } = await shell(
      `${fixtureFunctions()}; OWNER=bassey; load_cron_inventory_helper; cron_inventory_collect_external "$2"; cat "$2"`,
      [manifest],
      {
        RETIRE_OLLAMA_CRON_SYSTEM_FILE: system,
        RETIRE_OLLAMA_CRON_SYSTEM_DIR: systemDir,
        RETIRE_OLLAMA_CRON_SPOOL_DIR: spool,
      }
    );
    assert.deepEqual(stdout.trim().split('\n'), [
      `system\t-\t${system}`,
      `system-directory\t-\t${join(systemDir, 'cleanup')}`,
      `user\troot\t${join(spool, 'root')}`,
      `user\tworker\t${join(spool, 'worker')}`,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not apply owner serve-line exemptions to system or other-user sources', async () => {
  const directory = await fixtureDirectory('baci-cron-inventory-scope-');
  const system = join(directory, 'etc', 'crontab');
  const systemDir = join(directory, 'etc', 'cron.d');
  const spool = join(directory, 'spool', 'crontabs');
  try {
    await mkdir(systemDir, { recursive: true });
    await mkdir(spool, { recursive: true });
    const line = '0 * * * * /usr/bin/ollama serve';
    await Promise.all([
      writeFile(system, `${line}\n`),
      writeFile(join(spool, 'root'), `${line}\n`),
    ]);
    const { stdout } = await shell(
      `${fixtureFunctions()}; OWNER=bassey; load_cron_inventory_helper; OLLAMA_CRON_ONE=$(hash_text "$2"); deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; manifest=$(temp_path); cron_inventory_collect_external "$manifest"; while IFS="$(printf '\\t')" read -r kind account path; do case "$kind" in system) class=system-crontab;; user) class=user-crontab;; *) continue;; esac; record_consumers "$class" "$path" cron-unapproved; done <"$manifest"; printf '%s\\n' "$consumer_counts"`,
      [line],
      {
        RETIRE_OLLAMA_CRON_SYSTEM_FILE: system,
        RETIRE_OLLAMA_CRON_SYSTEM_DIR: systemDir,
        RETIRE_OLLAMA_CRON_SPOOL_DIR: spool,
      }
    );
    assert.deepEqual(JSON.parse(stdout), [
      { surface: 'system-crontab', matchCount: 1 },
      { surface: 'user-crontab', matchCount: 1 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed on an unbound per-user cron spool entry', async () => {
  const directory = await fixtureDirectory('baci-cron-inventory-unbound-');
  const system = join(directory, 'etc', 'crontab');
  const systemDir = join(directory, 'etc', 'cron.d');
  const spool = join(directory, 'spool', 'crontabs');
  try {
    await mkdir(systemDir, { recursive: true });
    await mkdir(spool, { recursive: true });
    await Promise.all([
      writeFile(system, '0 * * * * /usr/bin/other\n'),
      writeFile(join(spool, 'unknown'), '0 * * * * /usr/bin/ollama serve\n'),
    ]);
    await assert.rejects(
      shell(
        `${fixtureFunctions()}; OWNER=bassey; load_cron_inventory_helper; cron_inventory_collect_external "$2"`,
        [join(directory, 'manifest')],
        {
          RETIRE_OLLAMA_CRON_SYSTEM_FILE: system,
          RETIRE_OLLAMA_CRON_SYSTEM_DIR: systemDir,
          RETIRE_OLLAMA_CRON_SPOOL_DIR: spool,
        }
      ),
      (error) =>
        error.code === 65 && /unbound cron spool entry/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('requires the canonical root:crontab spool authority and a unique account binding', async () => {
  const directory = await fixtureDirectory('baci-cron-inventory-trust-');
  const system = join(directory, 'etc', 'crontab');
  const systemDir = join(directory, 'etc', 'cron.d');
  const spool = join(directory, 'spool', 'crontabs');
  try {
    await mkdir(systemDir, { recursive: true });
    await mkdir(spool, { recursive: true });
    await Promise.all([
      writeFile(system, '0 * * * * /usr/bin/other\\n'),
      writeFile(join(spool, 'worker'), '0 * * * * /usr/bin/ollama serve\\n'),
    ]);
    const command = `${fixtureFunctions()}; OWNER=bassey; load_cron_inventory_helper; cron_inventory_collect_external "$2"`;
    for (const env of [
      { CRON_SPOOL_GID: '999' },
      { GETENT_MULTI_GROUP: '1' },
      { GETENT_MULTI_USER: '1' },
    ]) {
      await assert.rejects(
        shell(command, [join(directory, 'manifest')], {
          RETIRE_OLLAMA_CRON_SYSTEM_FILE: system,
          RETIRE_OLLAMA_CRON_SYSTEM_DIR: systemDir,
          RETIRE_OLLAMA_CRON_SPOOL_DIR: spool,
          ...env,
        }),
        (error) =>
          error.code === 65 &&
          /unsafe cron spool directory|unbound cron spool entry/.test(
            error.stderr
          )
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed on symlinked system cron entries', async () => {
  const directory = await fixtureDirectory('baci-cron-inventory-link-');
  const system = join(directory, 'etc', 'crontab');
  const systemDir = join(directory, 'etc', 'cron.d');
  const spool = join(directory, 'spool', 'crontabs');
  try {
    await mkdir(systemDir, { recursive: true });
    await mkdir(spool, { recursive: true });
    await writeFile(system, '0 * * * * /usr/bin/other\n');
    await writeFile(
      join(directory, 'outside'),
      '0 * * * * /usr/bin/ollama serve\n'
    );
    await symlink(join(directory, 'outside'), join(systemDir, 'escaped'));
    await assert.rejects(
      shell(
        `${fixtureFunctions()}; OWNER=bassey; load_cron_inventory_helper; cron_inventory_collect_external "$2"`,
        [join(directory, 'manifest')],
        {
          RETIRE_OLLAMA_CRON_SYSTEM_FILE: system,
          RETIRE_OLLAMA_CRON_SYSTEM_DIR: systemDir,
          RETIRE_OLLAMA_CRON_SPOOL_DIR: spool,
        }
      ),
      (error) =>
        error.code === 65 && /unsafe system cron entry/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses a cron source changed between capture and identity recording', async () => {
  const directory = await fixtureDirectory('baci-cron-inventory-race-');
  const system = join(directory, 'etc', 'crontab');
  const systemDir = join(directory, 'etc', 'cron.d');
  const spool = join(directory, 'spool', 'crontabs');
  try {
    await mkdir(systemDir, { recursive: true });
    await mkdir(spool, { recursive: true });
    await writeFile(system, '0 * * * * /usr/bin/other\n');
    await chmod(system, 0o666);
    await assert.rejects(
      shell(
        `${fixtureFunctions()}; OWNER=bassey; load_cron_inventory_helper; CONSUMER_SCANNERS_LOADED=yes; consumer_canonical_regular() { printf '%s\\n' "$1"; }; consumer_snapshot() { snapshot=$(temp_path); cat "$1" >"$snapshot"; printf '%s\\n' '0 * * * * /usr/bin/ollama serve' >"$1"; printf '%s|before\\n' "$snapshot"; }; consumer_source_identity() { printf 'after\\n'; }; records='[]'; record_external_cron_sources`,
        [],
        {
          RETIRE_OLLAMA_CRON_SYSTEM_FILE: system,
          RETIRE_OLLAMA_CRON_SYSTEM_DIR: systemDir,
          RETIRE_OLLAMA_CRON_SPOOL_DIR: spool,
        }
      ),
      (error) =>
        error.code === 65 &&
        /cron source changed during capture/.test(error.stderr)
    );
    assert.equal(
      await readFile(system, 'utf8'),
      '0 * * * * /usr/bin/ollama serve\n'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
