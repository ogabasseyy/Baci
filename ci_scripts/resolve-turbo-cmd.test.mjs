import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  new URL('./resolve-turbo-cmd.sh', import.meta.url),
  'utf8'
);

test('emits ENV, TURBO_CMD, and FILTERS sentinel tokens', () => {
  assert.match(source, /---ENV---/);
  assert.match(source, /---TURBO_CMD---/);
  assert.match(source, /---FILTERS---/);
});

test('requires ACTIVE_DIR environment variable', () => {
  assert.match(source, /ACTIVE_DIR.*must be set/);
});

test('checks for dep-less worktree before configuring pnpm', () => {
  assert.match(source, /is-dep-less-worktree\.sh/);
});

test('prefers local turbo binary over pnpm turbo', () => {
  assert.match(source, /node_modules\/\.bin\/turbo/);
});

test('emits dep-less pnpm env for the parent process to export', () => {
  assert.match(source, /PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false/);
  assert.match(source, /PNPM_CONFIG_ALLOW_UNUSED_PATCHES=true/);
});

// --- Affected-scope behaviour (runs the real scripts against throwaway repos) ---

const resolverPath = fileURLToPath(
  new URL('./resolve-turbo-cmd.sh', import.meta.url)
);
const affectedBasePath = fileURLToPath(
  new URL('./quality-gate-affected-base.sh', import.meta.url)
);

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

// A worktree stand-in: ci_scripts copied in, a base commit that origin/main
// points at (unless withOrigin is false), and a later HEAD commit on top.
function createWorktree({ withOrigin = true, withAffectedScript = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-turbo-affected-'));
  git(dir, 'init', '-q');
  const base = commit(dir, 'base');
  if (withOrigin) {
    git(dir, 'update-ref', 'refs/remotes/origin/main', base);
  }
  commit(dir, 'work');
  mkdirSync(join(dir, 'ci_scripts'));
  copyFileSync(resolverPath, join(dir, 'ci_scripts/resolve-turbo-cmd.sh'));
  if (withAffectedScript) {
    copyFileSync(
      affectedBasePath,
      join(dir, 'ci_scripts/quality-gate-affected-base.sh')
    );
    chmodSync(join(dir, 'ci_scripts/quality-gate-affected-base.sh'), 0o755);
  }
  // Stand-in for the sparse-exclude helper so we can prove it is preserved.
  writeFileSync(
    join(dir, 'ci_scripts/turbo-sparse-exclude-filters.sh'),
    "#!/bin/sh\nprintf '%s\\0' '--filter=!@baci/skipped'\n"
  );
  chmodSync(join(dir, 'ci_scripts/turbo-sparse-exclude-filters.sh'), 0o755);
  return { dir, base };
}

function resolve(dir, env = {}) {
  const result = spawnSync(
    'bash',
    [join(dir, 'ci_scripts/resolve-turbo-cmd.sh')],
    {
      encoding: 'utf8',
      env: cleanEnv({ ACTIVE_DIR: dir, PNPM: 'pnpm', ...env }),
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const sections = { env: [], cmd: [], filters: [] };
  let current = null;
  for (const token of result.stdout.split('\0').slice(0, -1)) {
    if (token === '---ENV---') current = 'env';
    else if (token === '---TURBO_CMD---') current = 'cmd';
    else if (token === '---FILTERS---') current = 'filters';
    else sections[current].push(token);
  }
  return sections;
}

test('scopes to affected packages from the origin/main merge base', () => {
  const { dir, base } = createWorktree();
  try {
    const sections = resolve(dir);

    assert.ok(
      sections.env.includes(`TURBO_SCM_BASE=${base}`),
      `expected TURBO_SCM_BASE=${base} in ${JSON.stringify(sections.env)}`
    );
    assert.deepEqual(sections.filters, [
      '--filter=!@baci/skipped',
      '--affected',
    ]);
    assert.deepEqual(sections.cmd, ['pnpm', 'turbo']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QUALITY_GATE_FULL=1 keeps the full gate (no base, no --affected)', () => {
  const { dir } = createWorktree();
  try {
    const sections = resolve(dir, { QUALITY_GATE_FULL: '1' });

    assert.equal(
      sections.env.some((t) => t.startsWith('TURBO_SCM_BASE=')),
      false
    );
    assert.deepEqual(sections.filters, ['--filter=!@baci/skipped']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to the full gate when origin/main is missing', () => {
  const { dir } = createWorktree({ withOrigin: false });
  try {
    const sections = resolve(dir);

    assert.equal(
      sections.env.some((t) => t.startsWith('TURBO_SCM_BASE=')),
      false
    );
    assert.deepEqual(sections.filters, ['--filter=!@baci/skipped']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to the full gate when the checkout predates the helper script', () => {
  const { dir } = createWorktree({ withAffectedScript: false });
  try {
    const sections = resolve(dir);

    assert.equal(
      sections.env.some((t) => t.startsWith('TURBO_SCM_BASE=')),
      false
    );
    assert.deepEqual(sections.filters, ['--filter=!@baci/skipped']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
