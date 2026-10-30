import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(
  new URL('./quality-gate-affected-base.sh', import.meta.url)
);
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && key !== 'QUALITY_GATE_FULL') {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

function git(cwd, ...args) {
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

function commit(cwd, message) {
  git(cwd, 'commit', '-q', '--allow-empty', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function createRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'qg-affected-base-'));
  git(dir, 'init', '-q');
  return dir;
}

function run({ cwd, args = [], env = {} }) {
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

test('prints the merge base of HEAD and origin/main, not HEAD itself', () => {
  const repo = createRepo();
  try {
    const base = commit(repo, 'base');
    git(repo, 'update-ref', 'refs/remotes/origin/main', base);
    const head = commit(repo, 'work');
    assert.notEqual(head, base);

    const result = run({ cwd: repo, args: ['.'] });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, base);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('uses the fork point when origin/main has moved on', () => {
  const repo = createRepo();
  try {
    const base = commit(repo, 'base');
    const tree = git(repo, 'rev-parse', `${base}^{tree}`);
    const originTip = git(
      repo,
      'commit-tree',
      tree,
      '-p',
      base,
      '-m',
      'upstream'
    );
    git(repo, 'update-ref', 'refs/remotes/origin/main', originTip);
    commit(repo, 'work');

    const result = run({ cwd: repo, args: ['.'] });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, base);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('defaults the directory argument to the current directory', () => {
  const repo = createRepo();
  try {
    const base = commit(repo, 'base');
    git(repo, 'update-ref', 'refs/remotes/origin/main', base);
    commit(repo, 'work');

    const result = run({ cwd: repo });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, base);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('resolves the repository from the directory argument, not the cwd', () => {
  const repo = createRepo();
  const elsewhere = mkdtempSync(join(tmpdir(), 'qg-affected-elsewhere-'));
  try {
    const base = commit(repo, 'base');
    git(repo, 'update-ref', 'refs/remotes/origin/main', base);
    commit(repo, 'work');

    const result = run({ cwd: elsewhere, args: [repo] });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, base);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('prints nothing and exits 0 when QUALITY_GATE_FULL=1', () => {
  const repo = createRepo();
  try {
    const base = commit(repo, 'base');
    git(repo, 'update-ref', 'refs/remotes/origin/main', base);
    commit(repo, 'work');

    const result = run({
      cwd: repo,
      args: ['.'],
      env: { QUALITY_GATE_FULL: '1' },
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('only the value 1 forces the full gate', () => {
  const repo = createRepo();
  try {
    const base = commit(repo, 'base');
    git(repo, 'update-ref', 'refs/remotes/origin/main', base);
    commit(repo, 'work');

    const result = run({
      cwd: repo,
      args: ['.'],
      env: { QUALITY_GATE_FULL: '0' },
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, base);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('prints nothing and exits 0 when origin/main does not exist', () => {
  const repo = createRepo();
  try {
    commit(repo, 'base');

    const result = run({ cwd: repo, args: ['.'] });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('prints nothing and exits 0 when histories share no merge base', () => {
  const repo = createRepo();
  try {
    commit(repo, 'base');
    git(repo, 'hash-object', '-t', 'tree', '-w', '--stdin', '--literally');
    const orphan = git(repo, 'commit-tree', EMPTY_TREE, '-m', 'orphan');
    git(repo, 'update-ref', 'refs/remotes/origin/main', orphan);

    const result = run({ cwd: repo, args: ['.'] });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('prints nothing and exits 0 outside a git repository', () => {
  const notRepo = mkdtempSync(join(tmpdir(), 'qg-affected-norepo-'));
  try {
    const result = run({ cwd: notRepo, args: ['.'] });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(notRepo, { recursive: true, force: true });
  }
});
