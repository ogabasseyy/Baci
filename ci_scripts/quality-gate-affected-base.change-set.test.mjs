import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import {
  commit,
  createRepo,
  git,
  run,
  writeFile,
} from './quality-gate-affected-base.test-helpers.mjs';

// Commits the files written so far as the new origin/main base.
function rebaseOnto(dir) {
  git(dir, 'add', '-A');
  const base = commit(dir, 'base files');
  git(dir, 'update-ref', 'refs/remotes/origin/main', base);
  return base;
}

// Runs the helper after `setup`; setup may return a new base.
function gateFor(setup) {
  const dir = createRepo();
  try {
    const initial = commit(dir, 'base');
    git(dir, 'update-ref', 'refs/remotes/origin/main', initial);
    const base = setup(dir) ?? initial;
    return { stdout: run({ cwd: dir, args: [dir] }).stdout, base };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('keeps the full gate for an uncommitted change outside workspace packages', () => {
  const { stdout } = gateFor((dir) => {
    writeFile(dir, 'supabase/migrations/20990101000000_example.sql');
  });
  assert.equal(stdout, '');
});

test('keeps the full gate for a committed root-level change', () => {
  const { stdout } = gateFor((dir) => {
    writeFile(dir, 'turbo.json', '{}\n');
    git(dir, 'add', 'turbo.json');
    commit(dir, 'root config');
  });
  assert.equal(stdout, '');
});

test('scopes changes inside workspace packages and unnamed Markdown elsewhere', () => {
  const { stdout, base } = gateFor((dir) => {
    writeFile(dir, 'apps/web/src/changed.ts');
    writeFile(dir, 'packages/shared/src/changed.ts');
    writeFile(dir, 'docs/notes.md');
  });
  assert.equal(stdout, base);
});

test('keeps the full gate for Markdown that a package file names', () => {
  const { stdout } = gateFor((dir) => {
    writeFile(dir, 'apps/web/docs.test.ts', "readFileSync('AGENTS.md');\n");
    const base = rebaseOnto(dir);
    writeFile(dir, 'AGENTS.md', 'changed\n');
    return base;
  });
  assert.equal(stdout, '');
});

test('keeps the full gate when another workspace names a changed file', () => {
  const { stdout } = gateFor((dir) => {
    writeFile(
      dir,
      'apps/mobile-storefront/config.test.mjs',
      "resolve(root, 'apps/mobile-admin/app.config.ts');\n"
    );
    writeFile(dir, 'apps/mobile-admin/app.config.ts', 'export default {};\n');
    const base = rebaseOnto(dir);
    writeFile(dir, 'apps/mobile-admin/app.config.ts', 'export default { a: 1 };\n');
    return base;
  });
  assert.equal(stdout, '');
});

test('stays scoped when only its own workspace names a changed file', () => {
  const { stdout, base } = gateFor((dir) => {
    writeFile(dir, 'apps/web/src/a.test.ts', "read('apps/web/src/b.ts');\n");
    writeFile(dir, 'apps/web/src/b.ts', 'export const b = 1;\n');
    const base = rebaseOnto(dir);
    writeFile(dir, 'apps/web/src/b.ts', 'export const b = 2;\n');
    return base;
  });
  assert.equal(stdout, base);
});
