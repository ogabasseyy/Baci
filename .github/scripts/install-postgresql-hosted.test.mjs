import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./install-postgresql-hosted.sh', import.meta.url));
const BUILD = '18.6-1.pgdg24.04+2';
const FINGERPRINT = 'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8';

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
      'sudo apt-get -o Acquire::Retries=3 update',
      `sudo apt-get -o Acquire::Retries=3 install -y postgresql-18=${BUILD} postgresql-client-18=${BUILD}`,
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
    assert.ok(result.privileged.some((line) => line.includes(`install -y postgresql-18=${BUILD}`)), JSON.stringify(installed));
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
  assert.ok(result.privileged.some((line) => line.startsWith('sudo apt-get')));
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
