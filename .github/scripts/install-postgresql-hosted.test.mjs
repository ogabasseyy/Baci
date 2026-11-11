import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./install-postgresql-hosted.sh', import.meta.url));
const BUILD = '18.6-1.pgdg24.04+2';
const FINGERPRINT = 'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8';
// Every apt call is bounded: a few seconds per connection, three tries, and a ceiling for the whole command. The
// ceiling (timeout) runs under sudo, so its signal reaches apt-get itself and not just a sudo wrapped around it.
const APT_LIMIT_SECONDS = 180;
const SUDO_APT = `sudo timeout --kill-after=10 ${APT_LIMIT_SECONDS} apt-get`;
const APT_BOUNDS = '-o Acquire::Retries=3 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o DPkg::Lock::Timeout=60';
// The first refresh reads only the PGDG source, so an unreachable Ubuntu mirror cannot stall the step.
const PGDG_ONLY = '-o Dir::Etc::sourcelist=/etc/apt/sources.list.d/pgdg.list -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0';
const INSTALL = `${SUDO_APT} ${APT_BOUNDS} install -y --no-install-recommends postgresql-18=${BUILD} postgresql-client-18=${BUILD}`;

// The script is run for real, but sudo, curl, gpg and dpkg-query are stand-ins that only
// write what they were asked to do into a log. Nothing privileged ever runs here.
const root = mkdtempSync(join(tmpdir(), 'install-postgresql-hosted-'));
const bin = join(root, 'bin');
mkdirSync(bin);
after(() => rmSync(root, { recursive: true, force: true }));

function stub(name, lines) {
  const path = join(bin, name);
  writeFileSync(path, `#!/bin/sh\n${lines.join('\n')}\n`);
  chmodSync(path, 0o755);
}

stub('sudo', [
  `{ printf 'sudo'; for argument in "$@"; do printf ' %s' "$argument"; done; printf '\\n'; } >> "$FAKE_LOG"`,
  `if [ "$1" = tee ]; then sed 's/^/  stdin: /' >> "$FAKE_LOG"; fi`,
  // FAKE_APT_INSTALL_FAILURES=1 (or FAKE_APT_UPDATE_FAILURES=1) makes the first apt-get install (or update) fail,
  // the way an unreachable mirror does.
  `case " $* " in *' apt-get '*)`,
  `  for argument in "$@"; do`,
  `    if [ "$argument" = install ]; then`,
  `      attempts="$(cat "$FAKE_LOG.installs" 2>/dev/null || echo 0)"; attempts=$((attempts + 1)); echo "$attempts" > "$FAKE_LOG.installs"`,
  `      if [ "$attempts" -le "\${FAKE_APT_INSTALL_FAILURES:-0}" ]; then exit 100; fi`,
  `    fi`,
  `    if [ "$argument" = update ]; then`,
  `      attempts="$(cat "$FAKE_LOG.updates" 2>/dev/null || echo 0)"; attempts=$((attempts + 1)); echo "$attempts" > "$FAKE_LOG.updates"`,
  `      if [ "$attempts" -le "\${FAKE_APT_UPDATE_FAILURES:-0}" ]; then exit 100; fi`,
  `    fi`,
  `  done ;;`,
  `esac`,
  `case " $* " in *' dpkg '*) if [ -n "\${FAKE_DPKG_FAIL:-}" ]; then exit 2; fi ;; esac`,
]);
stub('curl', [
  `output=''; url=''`,
  `while [ "$#" -gt 0 ]; do`,
  `  case "$1" in --output) output="$2"; shift ;; https://*) url="$1" ;; esac`,
  `  shift`,
  `done`,
  `printf 'curl %s\\n' "$url" >> "$FAKE_LOG"`,
  `if [ -n "\${FAKE_CURL_FAIL:-}" ]; then exit 22; fi`,
  `printf 'fake key bytes' > "$output"`,
]);
stub('gpg', [
  `printf 'gpg %s\\n' "$*" >> "$FAKE_LOG"`,
  `if [ -n "\${FAKE_GPG_FAIL:-}" ]; then exit 2; fi`,
  `printf 'pub:-:4096:1:7FCC7D46ACCC4CF8:1318537154:::-:::scSC::::::23::0:\\n'`,
  `printf 'fpr:::::::::%s:\\n' "\${FAKE_GPG_FINGERPRINT:-${FINGERPRINT}}"`,
  `printf 'uid:-::::1483540543::690A171644E1C59F7E5E68775492644846BBC421::PostgreSQL Debian Repository::::::::::0:\\n'`,
  `if [ -n "\${FAKE_GPG_SUBKEY:-}" ]; then`,
  `  printf 'sub:-:4096:1:1111111111111111:1318537154::::::e::::::23:\\n'`,
  `  printf 'fpr:::::::::1111111111111111111111111111111111111111:\\n'`,
  `fi`,
  `if [ -n "\${FAKE_GPG_EXTRA_PRIMARY:-}" ]; then`,
  `  printf 'pub:-:4096:1:2222222222222222:1318537154:::-:::scSC::::::23::0:\\n'`,
  `  printf 'fpr:::::::::2222222222222222222222222222222222222222:\\n'`,
  `fi`,
]);
stub('dpkg-query', [
  `printf 'dpkg-query %s\\n' "$*" >> "$FAKE_LOG"`,
  `for argument in "$@"; do package="$argument"; done`,
  `case "$package" in`,
  `  postgresql-18) version="\${FAKE_INSTALLED_SERVER:-}" ;;`,
  `  postgresql-client-18) version="\${FAKE_INSTALLED_CLIENT:-}" ;;`,
  `  *) version='' ;;`,
  `esac`,
  `if [ -z "$version" ]; then exit 1; fi`,
  `printf '%s' "$version"`,
]);

let runs = 0;
function install({ runner = 'github-hosted', ...fake } = {}) {
  runs += 1;
  const dir = join(root, `run-${runs}`);
  mkdirSync(dir);
  const log = join(dir, 'commands.log');
  writeFileSync(log, '');
  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: dir,
      TMPDIR: dir,
      FAKE_LOG: log,
      // null leaves RUNNER_ENVIRONMENT unset, the way a plain shell would.
      ...(runner === null ? {} : { RUNNER_ENVIRONMENT: runner }),
      ...fake,
    },
  });
  const commands = readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    // The download folder is a fresh mktemp directory on every run.
    .map((line) => line.replace(/\S*\/tmp\.[A-Za-z0-9]+/g, '<work>'));
  return { ...result, commands, privileged: commands.filter((line) => line.startsWith('sudo ')) };
}

test('installs the pinned PostgreSQL 18 build from the signed PGDG repository on a hosted runner', () => {
  const result = install();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.commands.filter((line) => !line.startsWith('dpkg-query')),
    [
      'curl https://www.postgresql.org/media/keys/ACCC4CF8.asc',
      'gpg --batch --show-keys --with-colons <work>/pgdg.asc',
      'sudo install -d /usr/share/postgresql-common/pgdg',
      'sudo install -m 0644 <work>/pgdg.asc /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc',
      'sudo tee /etc/apt/sources.list.d/pgdg.list',
      '  stdin: deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main',
      `${SUDO_APT} ${APT_BOUNDS} ${PGDG_ONLY} update`,
      INSTALL,
    ]
  );
});

test('talks to the PostgreSQL servers over https only, the same way the official setup does', () => {
  const result = install();
  assert.equal(result.status, 0, result.stderr);
  const sourceLine = result.commands.find((line) => line.startsWith('  stdin: deb '));
  assert.ok(sourceLine, 'the installer must write an apt source line');
  assert.match(sourceLine, /\[signed-by=\S+\] https:\/\/apt\.postgresql\.org\/pub\/repos\/apt noble-pgdg main$/);
  // Neither the signing key download nor the package source may use cleartext http.
  assert.doesNotMatch(result.commands.join('\n'), /http:\/\//);
});

test('refuses to run anywhere but a GitHub-hosted runner, before any command', () => {
  for (const runner of [null, '', 'self-hosted', 'GitHub-Hosted']) {
    const result = install({ runner });
    assert.equal(result.status, 1, `runner ${JSON.stringify(runner)}`);
    assert.match(result.stderr, /outside a GitHub-hosted runner/);
    assert.deepEqual(result.commands, [], `runner ${JSON.stringify(runner)} must not run anything`);
  }
});

test('does nothing when the pinned build is already installed, so a second call in a job is cheap', () => {
  const result = install({ FAKE_INSTALLED_SERVER: BUILD, FAKE_INSTALLED_CLIENT: BUILD });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already installed/);
  assert.deepEqual(
    result.commands.filter((line) => !line.startsWith('dpkg-query')),
    []
  );
});

test('still installs when only one package, or another build, is present', () => {
  for (const installed of [
    { FAKE_INSTALLED_SERVER: BUILD },
    { FAKE_INSTALLED_SERVER: BUILD, FAKE_INSTALLED_CLIENT: '18.3-1.pgdg24.04+1' },
    { FAKE_INSTALLED_SERVER: '18.3-1.pgdg24.04+1', FAKE_INSTALLED_CLIENT: BUILD },
  ]) {
    const result = install(installed);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.privileged.some((line) => line.includes(`install -y --no-install-recommends postgresql-18=${BUILD}`)), JSON.stringify(installed));
  }
});

test('rejects a repository key with an unexpected fingerprint before touching the system', () => {
  const result = install({ FAKE_GPG_FINGERPRINT: '0000000000000000000000000000000000000000' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected PostgreSQL repository signing key: 0{40}/);
  assert.deepEqual(result.privileged, []);
});

test('rejects a key file that carries a second primary key next to the expected one', () => {
  const result = install({ FAKE_GPG_EXTRA_PRIMARY: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected PostgreSQL repository signing key/);
  assert.deepEqual(result.privileged, []);
});

test('accepts the expected key together with its subkeys', () => {
  const result = install({ FAKE_GPG_SUBKEY: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.privileged.some((line) => line.startsWith(SUDO_APT)));
});

test('stops before any privileged command when the key cannot be downloaded or read', () => {
  for (const fake of [{ FAKE_CURL_FAIL: '1' }, { FAKE_GPG_FAIL: '1' }]) {
    const result = install(fake);
    assert.notEqual(result.status, 0, JSON.stringify(fake));
    assert.deepEqual(result.privileged, [], JSON.stringify(fake));
  }
});

test('pins an exact PostgreSQL 18 Ubuntu 24.04 build, not a moving package name', () => {
  const script = readFileSync(SCRIPT, 'utf8');
  assert.match(script, /^PG_BUILD='18\.\d+-1\.pgdg24\.04\+\d+'$/m);
  assert.match(script, /"postgresql-18=\$\{PG_BUILD\}" "postgresql-client-18=\$\{PG_BUILD\}"/);
  assert.match(script, new RegExp(`^PGDG_KEY_FINGERPRINT='${FINGERPRINT}'$`, 'm'));
});

const aptCommands = (result) => result.privileged.filter((line) => line.startsWith(SUDO_APT));
const isUpdate = (line) => / update$/.test(line);

describe('bugfix: the install must not hang on an unreachable Ubuntu mirror (2026-11-11 outage)', () => {
  // On 2026-11-11 the Azure Ubuntu mirror that hosted runners use stopped answering. The installer ran a full
  // `apt-get update`, which waited 20 seconds per mirror entry, three times over, and then failed. Disposable SQL,
  // DB Replay and Misc failed on every pull request, although the PostgreSQL repository itself answered at once.
  test('refreshes only the PGDG package index, so an unreachable Ubuntu mirror cannot stall a healthy install', () => {
    const result = install();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(aptCommands(result).filter(isUpdate), [`${SUDO_APT} ${APT_BOUNDS} ${PGDG_ONLY} update`]);
    assert.ok(!result.privileged.some((line) => line.includes('apt-mirrors.txt')), 'a healthy install must leave the mirror list alone');
  });

  test('bounds every apt command: a time ceiling for the whole command and short, retried connections', () => {
    for (const fake of [{}, { FAKE_APT_INSTALL_FAILURES: '1' }]) {
      const result = install(fake);
      assert.equal(result.status, 0, result.stderr);
      const apt = result.privileged.filter((line) => line.includes(' apt-get '));
      assert.ok(apt.length >= 2, 'the refresh and the install both go through apt-get');
      for (const line of apt) {
        assert.ok(line.startsWith(`${SUDO_APT} `), `${line} must run under the time ceiling, as root`);
        assert.ok(line.includes(APT_BOUNDS), line);
      }
    }
    const script = readFileSync(SCRIPT, 'utf8');
    assert.match(script, new RegExp(`^APT_LIMIT_SECONDS=${APT_LIMIT_SECONDS}$`, 'm'));
    assert.match(script, /sudo timeout --kill-after=\d+ "\$APT_LIMIT_SECONDS" apt-get/);
  });

  // What the script does after a failed first attempt: independent full mirrors ahead of Canonical's own servers
  // (both were unreachable in the 2026-11-11 outage), Azure demoted to last, one full refresh, one more install.
  const FALLBACK = [
    'sudo tee /etc/apt/apt-mirrors.txt',
    '  stdin: https://mirrors.edge.kernel.org/ubuntu/\tpriority:1',
    '  stdin: https://ubuntu.osuosl.org/ubuntu/\tpriority:2',
    '  stdin: https://archive.ubuntu.com/ubuntu/\tpriority:3',
    '  stdin: https://azure.archive.ubuntu.com/ubuntu/\tpriority:4',
    // A command stopped by the ceiling can leave dpkg half-way through a package; finish that work before the retry.
    `sudo timeout --kill-after=10 ${APT_LIMIT_SECONDS} dpkg --configure -a`,
    `${SUDO_APT} ${APT_BOUNDS} update`,
    INSTALL,
  ];

  test('switches to independent and canonical Ubuntu mirrors and refreshes everything when the first install fails', () => {
    const result = install({ FAKE_APT_INSTALL_FAILURES: '1' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /The install failed .* independent and canonical Ubuntu mirrors/);
    // Whether the rewrite can help depends on the runner image, so the log always says so one way or the other.
    assert.match(result.stdout, /mirror list/);
    assert.deepEqual(result.commands.slice(result.commands.indexOf(INSTALL) + 1), FALLBACK);
    // Azure is demoted, not deleted, so the list keeps a second path. Every entry, Azure included, uses https.
    assert.doesNotMatch(result.commands.join('\n'), /http:\/\//);
  });

  test('keeps going, and says so, when repairing dpkg before the retry fails', () => {
    const result = install({ FAKE_APT_INSTALL_FAILURES: '1', FAKE_DPKG_FAIL: '1' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /dpkg --configure -a exited with status 2/);
    assert.equal(aptCommands(result).filter((line) => line === INSTALL).length, 2, 'the retry still runs');
  });

  test('takes the same fallback when the PGDG-only refresh itself fails, without trying the install first', () => {
    const result = install({ FAKE_APT_UPDATE_FAILURES: '1' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /The PostgreSQL-only refresh failed/);
    const afterFirstRefresh = result.commands.slice(result.commands.indexOf(`${SUDO_APT} ${APT_BOUNDS} ${PGDG_ONLY} update`) + 1);
    assert.deepEqual(afterFirstRefresh, FALLBACK);
  });

  test('fails with a clear message, and never installs, when the PGDG-only refresh and the full refresh both fail', () => {
    const result = install({ FAKE_APT_UPDATE_FAILURES: '2' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Could not install PostgreSQL 18/);
    assert.equal(aptCommands(result).filter(isUpdate).length, 2, 'the PGDG refresh and one full refresh');
    assert.ok(!aptCommands(result).includes(INSTALL), 'no install is attempted on lists that did not refresh');
  });

  test('fails with a clear message, after exactly one retry, when the install still fails on the canonical mirrors', () => {
    const result = install({ FAKE_APT_INSTALL_FAILURES: '2' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Could not install PostgreSQL 18/);
    assert.equal(aptCommands(result).filter((line) => line === INSTALL).length, 2, 'one try plus one retry, never a loop');
    assert.equal(aptCommands(result).filter(isUpdate).length, 2, 'the PGDG refresh and one full refresh');
  });
});
