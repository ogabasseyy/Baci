import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

// Shared by the installer tests. The script is run for real, but sudo, curl, gpg, dpkg-query, apt-get and dpkg are
// stand-ins that only write what they were asked to do into a log. Nothing privileged ever runs here.
export const SCRIPT = fileURLToPath(new URL('./install-postgresql-hosted.sh', import.meta.url));
export const FINGERPRINT = 'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8';

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
  // FAKE_SUDO_EXEC=1 lets the real timeout run (under the stand-in sudo) so that the apt-get and dpkg stand-ins below
  // are executed and can stall; everything else stays a recording.
  `if [ "$1" = timeout ] && [ -n "\${FAKE_SUDO_EXEC:-}" ]; then exec "$@"; fi`,
  // FAKE_MIRROR_WRITE_FAIL=1 makes writing the Ubuntu mirror list fail (read-only file system, no space left).
  `if [ "$1" = tee ] && [ "\${2:-}" = /etc/apt/apt-mirrors.txt ] && [ -n "\${FAKE_MIRROR_WRITE_FAIL:-}" ]; then cat > /dev/null; exit 1; fi`,
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
// Only reached when FAKE_SUDO_EXEC=1. FAKE_APT_HANG_UPDATES=1 (or FAKE_APT_HANG_INSTALLS=1) makes the first apt-get
// update (or install) stall: it sleeps far longer than any ceiling a test sets, the way the unreachable mirror held
// apt on 2026-11-11. The sleep is the process the real timeout has to stop. A stalled command also starts a helper
// process, the way apt starts its download methods and dpkg, and writes its pid to "$FAKE_LOG.helpers": the ceiling has
// to take the helper down too, or it could go on holding the dpkg lock.
export const STALL_SECONDS = 60;
stub('apt-get', [
  `printf 'apt-get %s\\n' "$*" >> "$FAKE_LOG"`,
  `for argument in "$@"; do`,
  `  case "$argument" in install | update)`,
  `    attempts="$(cat "$FAKE_LOG.hangs-$argument" 2>/dev/null || echo 0)"; attempts=$((attempts + 1)); echo "$attempts" > "$FAKE_LOG.hangs-$argument"`,
  `    if [ "$argument" = install ]; then stalls="\${FAKE_APT_HANG_INSTALLS:-0}"; else stalls="\${FAKE_APT_HANG_UPDATES:-0}"; fi`,
  `    if [ "$attempts" -le "$stalls" ]; then`,
  `      sleep ${STALL_SECONDS} >/dev/null 2>&1 &`,
  `      echo "$!" >> "$FAKE_LOG.helpers"`,
  `      exec sleep ${STALL_SECONDS}`,
  `    fi ;;`,
  `  esac`,
  `done`,
]);
stub('dpkg', [`printf 'dpkg %s\\n' "$*" >> "$FAKE_LOG"`]);
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

// State letter of a process (Linux /proc, otherwise ps), or undefined when no such process exists.
export function processState(pid) {
  if (existsSync('/proc/self/stat')) {
    try {
      // "pid (name) S ..." — the name can hold spaces and brackets, so cut after the last ") ".
      return readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '')[0];
    } catch {
      return undefined;
    }
  }
  const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  return ps.error ? 'S' : (ps.stdout ?? '').trim()[0];
}

// True once the process can no longer hold anything. A killed process that nobody has reaped yet is a zombie
// (<defunct>): it still answers signal 0, for instance in a container whose PID 1 does not reap orphans, but it cannot
// hold a lock, so it counts as gone.
export function isGone(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error.code === 'ESRCH';
  }
  const state = processState(pid);
  return state === undefined || state === 'Z';
}

let runs = 0;
export function install({ runner = 'github-hosted', ...fake } = {}) {
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
  return { ...result, log, commands, privileged: commands.filter((line) => line.startsWith('sudo ')) };
}
