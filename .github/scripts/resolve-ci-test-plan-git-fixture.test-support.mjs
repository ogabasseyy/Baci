// Throwaway git repositories for the CI test planner tests. Global git config
// and hooks are ignored so a developer's lefthook or signing setup cannot leak
// into the fixture.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'planner-test',
  GIT_AUTHOR_EMAIL: 'planner-test@example.com',
  GIT_COMMITTER_NAME: 'planner-test',
  GIT_COMMITTER_EMAIL: 'planner-test@example.com',
};

export function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: GIT_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function createGitFixture() {
  const root = mkdtempSync(join(tmpdir(), 'ci-planner-fixture-'));
  git(root, 'init', '--quiet', '--initial-branch=main');

  const fixture = {
    root,
    write(file, contents = '') {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), contents);
    },
    remove(file) {
      rmSync(join(root, file), { force: true });
    },
    commit(message) {
      git(root, 'add', '--all');
      git(root, 'commit', '--quiet', '--message', message);
      return git(root, 'rev-parse', 'HEAD').trim();
    },
    branch(name) {
      git(root, 'checkout', '--quiet', '-b', name);
    },
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
  };

  return fixture;
}
