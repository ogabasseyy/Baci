import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cleanEnv,
  commit,
  createRepo,
  git,
  run,
  writeFile,
} from './quality-gate-affected-base.test-helpers.mjs';

// Contract the hooks rely on: with the helper's base (the commit HEAD shares
// with origin/main), `turbo run --affected` also selects packages with staged,
// unstaged or untracked work, even when HEAD itself equals that base. If a
// Turborepo upgrade ever stops doing so, the Stop hooks would report success
// without checking the edits that triggered them.

const turbo = fileURLToPath(
  new URL('../node_modules/.bin/turbo', import.meta.url)
);
const skip = existsSync(turbo) ? false : 'turbo is not installed';

function createWorkspace() {
  const dir = createRepo();
  writeFile(
    dir,
    'package.json',
    '{"name":"root","private":true,"packageManager":"pnpm@10.0.0"}\n'
  );
  writeFile(
    dir,
    'pnpm-workspace.yaml',
    'packages:\n  - apps/*\n  - packages/*\n'
  );
  writeFile(dir, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  writeFile(dir, 'turbo.json', '{"tasks":{"lint":{}}}\n');
  for (const [folder, name] of [
    ['apps/a', 'pkg-a'],
    ['apps/b', 'pkg-b'],
    ['packages/c', 'pkg-c'],
  ]) {
    writeFile(
      dir,
      `${folder}/package.json`,
      `{"name":"${name}","version":"1.0.0","scripts":{"lint":"echo ${name}"}}\n`
    );
    writeFile(dir, `${folder}/index.js`, 'export const x = 1;\n');
  }
  git(dir, 'add', '-A');
  const base = commit(dir, 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', base);
  return { dir, base };
}

// The test's own environment, minus any ambient Turborepo settings (remote
// cache credentials, a base ref) that could change what the dry run does.
function turboEnv(base) {
  const env = cleanEnv();
  for (const key of Object.keys(env)) {
    if (key.startsWith('TURBO_')) delete env[key];
  }
  return {
    ...env,
    TURBO_SCM_BASE: base,
    TURBO_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
  };
}

function affectedTasks(dir, base) {
  const result = spawnSync(turbo, ['run', 'lint', '--affected', '--dry=json'], {
    cwd: dir,
    encoding: 'utf8',
    env: turboEnv(base),
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  return plan.tasks.map((task) => task.taskId).sort();
}

const SCENARIOS = [
  [
    'an unstaged edit',
    (dir) => writeFile(dir, 'apps/a/index.js', 'export const x = 2;\n'),
    ['pkg-a#lint'],
  ],
  [
    'a staged edit',
    (dir) => {
      writeFile(dir, 'packages/c/index.js', 'export const x = 3;\n');
      git(dir, 'add', 'packages/c/index.js');
    },
    ['pkg-c#lint'],
  ],
  [
    'an untracked new file',
    (dir) => writeFile(dir, 'apps/b/new.js', 'export const y = 1;\n'),
    ['pkg-b#lint'],
  ],
];

for (const [label, change, expected] of SCENARIOS) {
  test(`--affected with the helper's base selects the package of ${label} while HEAD equals origin/main`, {
    skip,
  }, () => {
    const { dir, base } = createWorkspace();
    try {
      change(dir);
      assert.equal(run({ cwd: dir, args: [dir] }).stdout, base);
      assert.deepEqual(affectedTasks(dir, base), expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
