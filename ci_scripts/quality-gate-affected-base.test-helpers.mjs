// Shared fixtures for the quality-gate-affected-base.sh tests.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const scriptPath = fileURLToPath(
  new URL('./quality-gate-affected-base.sh', import.meta.url)
);
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && key !== 'QUALITY_GATE_FULL') {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

export function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv({
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      }),
    }
  ).trim();
}

export function commit(cwd, message) {
  git(cwd, 'commit', '-q', '--allow-empty', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

export function createRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'qg-affected-base-'));
  git(dir, 'init', '-q');
  return dir;
}

export function run({ cwd, args = [], env = {} }) {
  const result = spawnSync('sh', [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(env),
  });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr,
  };
}

export function writeFile(dir, path, content = 'x\n') {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}
