import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs the LIVE behind-base script from lefthook.yml (not a copy) against
// throwaway repositories, so a regression in the hook fails here instead of
// silently letting stale branches through or hanging pushes again.
function behindBaseScript() {
  const lines = readFileSync(
    new URL('../../lefthook.yml', import.meta.url),
    'utf8'
  ).split('\n');
  const jobIndex = lines.findIndex((line) => line === '    behind-base:');
  assert.ok(jobIndex >= 0, 'behind-base job must remain extractable');
  const runIndex = lines.findIndex(
    (line, index) => index > jobIndex && line === '      run: |'
  );
  assert.ok(runIndex > jobIndex, 'behind-base run block must remain extractable');
  const body = [];
  for (const line of lines.slice(runIndex + 1)) {
    if (line.trim() !== '' && !line.startsWith('        ')) break;
    body.push(line.slice(8));
  }
  return body.join('\n').replaceAll('{1}', 'origin');
}

// Hermetic git: ignore the developer's global/system config (global
// core.hooksPath shims, signing, credential helpers) so the throwaway repos
// behave the same on every machine and stay fast.
const emptyGlobalConfig = join(mkdtempSync(join(tmpdir(), 'git-cfg-')), 'gitconfig');
writeFileSync(emptyGlobalConfig, '');
// Drop inherited SSH transport overrides so each SSH test controls exactly
// which of GIT_SSH_COMMAND / GIT_SSH / core.sshCommand is in play, and the
// repository-location variables git exports when it runs a hook, so a suite
// launched from a hook never writes to the caller's repository.
const SCRUBBED_ENV = new Set([
  'GIT_SSH_COMMAND',
  'GIT_SSH',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
]);
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !SCRUBBED_ENV.has(key))
);

const gitEnv = {
  ...inheritedEnv,
  GIT_CONFIG_GLOBAL: emptyGlobalConfig,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv }).trim();

function commit(cwd, name) {
  writeFileSync(join(cwd, name), name);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-q', '-m', name);
  return git(cwd, 'rev-parse', 'HEAD');
}

// `partial: true` clones the work repo with a blob filter, so origin is a
// promisor remote and git may demand-fetch missing objects from it.
function setup({ partial = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'behind-base-'));
  const remote = join(root, 'remote.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(remote, 'config', 'uploadpack.allowFilter', 'true');
  git(remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  const seed = join(root, 'seed');
  git(root, 'clone', '-q', remote, seed);
  git(seed, 'checkout', '-q', '-b', 'main');
  commit(seed, 'base');
  git(seed, 'push', '-q', 'origin', 'main');
  const work = join(root, 'work');
  const cloneArgs = partial
    ? ['--filter=blob:none', `file://${remote}`]
    : [remote];
  git(root, 'clone', '-q', ...cloneArgs, work);
  git(work, 'remote', 'set-head', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'feature');
  const featureSha = commit(work, 'feature');
  return { root, remote, work, featureSha };
}

function advanceRemoteMain(root, remote) {
  const other = join(root, 'other');
  git(root, 'clone', '-q', remote, other);
  commit(other, 'peer');
  git(other, 'push', '-q', 'origin', 'main');
}

function runHook(work, featureSha) {
  return spawnSync('sh', ['-c', behindBaseScript()], {
    cwd: work,
    encoding: 'utf8',
    env: gitEnv,
    input: `refs/heads/feature ${featureSha} refs/heads/feature ${'0'.repeat(40)}\n`,
    timeout: 30_000,
  });
}

function fakeSsh(root, name) {
  const log = join(root, `${name}.log`);
  const script = join(root, name);
  writeFileSync(script, `#!/bin/sh\necho "$@" >> "${log}"\nexit 1\n`);
  chmodSync(script, 0o755);
  return { script, log };
}

function runHookWith(
  work,
  featureSha,
  env,
  input = pushInput({ branch: 'feature', sha: featureSha })
) {
  return spawnSync('sh', ['-c', behindBaseScript()], {
    cwd: work,
    encoding: 'utf8',
    env: { ...gitEnv, ...env },
    input,
    timeout: 30_000,
  });
}

const ZERO_SHA = '0'.repeat(40);

/** One pre-push stdin line per pushed `{ branch, sha }` (new remote branches). */
function pushInput(...pushes) {
  return pushes
    .map(
      ({ branch, sha }) =>
        `refs/heads/${branch} ${sha} refs/heads/${branch} ${ZERO_SHA}\n`
    )
    .join('');
}

// Runs the hook under the TEST's own hard deadline: on a regression (an
// unbounded wait) the whole process group is killed, so neither the hook nor
// a git child keeps this suite (and the CI job) alive. Resolves once the
// hook's stdio has closed, so a stray child still holding the hook's pipes
// shows up as a late `elapsedMs`, not a silent pass.
function runHookBounded(work, input, { env = {}, killAfterMs = 90_000 } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn('sh', ['-c', behindBaseScript()], {
      cwd: work,
      env: { ...gitEnv, ...env },
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    const finish = (result) =>
      resolve({ stdout, stderr, elapsedMs: Date.now() - startedAt, ...result });
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      finish({ status: null, timedOut: true });
    }, killAfterMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      finish({ status, timedOut: false });
    });
    child.stdin.end(input);
  });
}

const realGit = execFileSync('sh', ['-c', 'command -v git'], {
  encoding: 'utf8',
}).trim();

// A `git` ahead of the real one on PATH. It records every `ls-remote` call
// (call number in $n) and runs `onLsRemote` before delegating, so a test can
// count remote reads or make one of them slow or stuck. `version` makes
// `git --version` report that version (to exercise old-Git handling).
function gitShim(root, onLsRemote = ':', { version = '' } = {}) {
  const dir = join(root, 'shim');
  mkdirSync(dir);
  const log = join(root, 'ls-remote.log');
  writeFileSync(
    join(dir, 'git'),
    `#!/bin/sh
${version ? `[ "$*" = --version ] && { echo "git version ${version}"; exit 0; }` : ''}
for arg in "$@"; do
  if [ "$arg" = ls-remote ]; then
    echo "$*" >> "${log}"
    n=$(wc -l < "${log}" | tr -d ' ')
    ${onLsRemote}
    break
  fi
done
exec "${realGit}" "$@"
`
  );
  chmodSync(join(dir, 'git'), 0o755);
  const lsRemoteCalls = () =>
    existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
  return { dir, lsRemoteCalls };
}

// An `ssh` that records its pid and never answers, ignoring every timeout
// option it is given: a stand-in for a stall during DNS/TCP/TLS or SSH setup
// that http.lowSpeed*, ConnectTimeout and ServerAlive* cannot end. `kill()`
// removes any survivor so a failing test never leaves it behind. With
// `ignoreTerm` it also shrugs off SIGTERM, so only SIGKILL ends it.
function hangingSsh(root, { ignoreTerm = false } = {}) {
  const pidLog = join(root, 'ssh.pids');
  const trap = ignoreTerm ? "trap '' TERM\n" : '';
  writeFileSync(join(root, 'ssh'), `#!/bin/sh\n${trap}echo $$ >> "${pidLog}"\nexec sleep 600\n`);
  chmodSync(join(root, 'ssh'), 0o755);
  const pids = () =>
    existsSync(pidLog)
      ? readFileSync(pidLog, 'utf8').split('\n').filter(Boolean).map(Number)
      : [];
  const kill = () => {
    for (const pid of pids()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  };
  return { kill, pids };
}

// A process is alive unless it is gone or a zombie waiting to be reaped.
function isAlive(pid) {
  const { stdout } = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  const state = stdout.trim();
  return state !== '' && !state.startsWith('Z');
}

async function allGone(pids, timeoutMs = 5_000) {
  const until = Date.now() + timeoutMs;
  while (pids.some(isAlive) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !pids.some(isAlive);
}

// GIT_NO_LAZY_FETCH (keeps local lookups from demand-fetching from a promisor
// remote) first shipped in Git 2.45.0 (absent from v2.44.x).
function gitSupportsNoLazyFetch() {
  const [, major, minor] = /(\d+)\.(\d+)/.exec(git('.', '--version')) ?? [];
  return Number(major) > 2 || (Number(major) === 2 && Number(minor) >= 45);
}

/** Fixtures for running the live behind-base hook against throwaway repos. */
export const behindBaseFixture = {
  advanceRemoteMain,
  allGone,
  behindBaseScript,
  commit,
  fakeSsh,
  git,
  gitEnv,
  gitShim,
  gitSupportsNoLazyFetch,
  hangingSsh,
  pushInput,
  runHook,
  runHookBounded,
  runHookWith,
  setup,
};
