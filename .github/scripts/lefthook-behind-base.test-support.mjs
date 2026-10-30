import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
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
// which of GIT_SSH_COMMAND / GIT_SSH / core.sshCommand is in play.
const { GIT_SSH_COMMAND: _sshCommand, GIT_SSH: _ssh, ...inheritedEnv } =
  process.env;

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

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'behind-base-'));
  const remote = join(root, 'remote.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  const work = join(root, 'work');
  git(root, 'clone', '-q', remote, work);
  git(work, 'checkout', '-q', '-b', 'main');
  commit(work, 'base');
  git(work, 'push', '-q', 'origin', 'main');
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

function runHookWith(work, featureSha, env) {
  return spawnSync('sh', ['-c', behindBaseScript()], {
    cwd: work,
    encoding: 'utf8',
    env: { ...gitEnv, ...env },
    input: `refs/heads/feature ${featureSha} refs/heads/feature ${'0'.repeat(40)}\n`,
    timeout: 30_000,
  });
}

/** Fixtures for running the live behind-base hook against throwaway repos. */
export const behindBaseFixture = {
  advanceRemoteMain,
  behindBaseScript,
  commit,
  fakeSsh,
  git,
  gitEnv,
  runHook,
  runHookWith,
  setup,
};
