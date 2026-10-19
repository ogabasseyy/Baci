import assert from 'node:assert/strict';
import { execSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(
  new URL('./is-dep-less-worktree.sh', import.meta.url)
);
const isSparseScript = fileURLToPath(
  new URL('./is-sparse-checkout.sh', import.meta.url)
);

function createGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dep-less-wt-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execSync('git add . && git commit -m init', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function runScript(cwd) {
  try {
    execFileSync('sh', [scriptPath], {
      cwd,
      stdio: 'pipe',
      env: { ...process.env, PATH: process.env.PATH },
    });
    return 0;
  } catch (error) {
    return error.status;
  }
}

test('returns 0 (dep-less) when node_modules is a symlink', () => {
  const repo = createGitRepo();
  try {
    const target = mkdtempSync(join(tmpdir(), 'nm-target-'));
    symlinkSync(target, join(repo, 'node_modules'));
    mkdirSync(join(repo, 'ci_scripts'), { recursive: true });
    execSync(`cp "${scriptPath}" "${join(repo, 'ci_scripts/')}"`, { stdio: 'ignore' });
    execSync(`cp "${isSparseScript}" "${join(repo, 'ci_scripts/')}"`, { stdio: 'ignore' });

    assert.equal(runScript(repo), 0);
    rmSync(target, { recursive: true });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('returns 1 (not dep-less) for a normal repo with real node_modules', () => {
  const repo = createGitRepo();
  try {
    mkdirSync(join(repo, 'node_modules'));
    mkdirSync(join(repo, 'ci_scripts'), { recursive: true });
    execSync(`cp "${scriptPath}" "${join(repo, 'ci_scripts/')}"`, { stdio: 'ignore' });
    execSync(`cp "${isSparseScript}" "${join(repo, 'ci_scripts/')}"`, { stdio: 'ignore' });

    assert.equal(runScript(repo), 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('returns 1 (not dep-less) for a normal repo without node_modules', () => {
  const repo = createGitRepo();
  try {
    mkdirSync(join(repo, 'ci_scripts'), { recursive: true });
    execSync(`cp "${scriptPath}" "${join(repo, 'ci_scripts/')}"`, { stdio: 'ignore' });
    execSync(`cp "${isSparseScript}" "${join(repo, 'ci_scripts/')}"`, { stdio: 'ignore' });

    assert.equal(runScript(repo), 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
