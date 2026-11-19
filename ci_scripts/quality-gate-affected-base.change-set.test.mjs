import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  commit,
  gateFor,
  git,
  rebaseOnto,
  writeFile,
} from './quality-gate-affected-base.test-helpers.mjs';

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
    writeFile(
      dir,
      'apps/mobile-admin/app.config.ts',
      'export default { a: 1 };\n'
    );
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

// Another workspace's test names the original path of a file that is renamed
// away. Git's rename detection would list only the destination, so the old
// path (the one the other workspace still reads) must be searched too.
const RENAME_FIXTURE = {
  referrer: 'apps/mobile-storefront/config.test.mjs',
  referrerBody: "resolve(root, 'apps/mobile-admin/app.config.ts');\n",
  source: 'apps/mobile-admin/app.config.ts',
  destination: 'apps/mobile-admin/app.config.renamed.ts',
  body: "export default { name: 'admin', version: 1 };\n",
};

function renameSetup(dir, { commitRename }) {
  writeFile(dir, RENAME_FIXTURE.referrer, RENAME_FIXTURE.referrerBody);
  writeFile(dir, RENAME_FIXTURE.source, RENAME_FIXTURE.body);
  const base = rebaseOnto(dir);
  git(dir, 'mv', RENAME_FIXTURE.source, RENAME_FIXTURE.destination);
  if (commitRename) commit(dir, 'rename config');
  return base;
}

test('bugfix: keeps the full gate when a committed rename moves a file another workspace names', () => {
  const { stdout } = gateFor((dir) => renameSetup(dir, { commitRename: true }));
  assert.equal(stdout, '');
});

test('bugfix: keeps the full gate when a staged rename moves a file another workspace names', () => {
  const { stdout } = gateFor((dir) =>
    renameSetup(dir, { commitRename: false })
  );
  assert.equal(stdout, '');
});

test('stays scoped when a rename moves a file nothing else names', () => {
  const { stdout, base } = gateFor((dir) => {
    writeFile(dir, 'apps/mobile-admin/old-name.ts', 'export const a = 1;\n');
    const base = rebaseOnto(dir);
    git(
      dir,
      'mv',
      'apps/mobile-admin/old-name.ts',
      'apps/mobile-admin/new-name.ts'
    );
    commit(dir, 'rename unreferenced file');
    return base;
  });
  assert.equal(stdout, base);
});

test('bugfix: keeps the full gate for a file directly under apps/', () => {
  const { stdout } = gateFor((dir) => {
    writeFile(dir, 'apps/android-sdk-defaults.gradle', 'minSdk = 24\n');
  });
  assert.equal(stdout, '');
});

test('bugfix: keeps the full gate for a file directly under packages/', () => {
  const { stdout } = gateFor((dir) => {
    writeFile(dir, 'packages/tsconfig.base.json', '{}\n');
  });
  assert.equal(stdout, '');
});

test('stays scoped for the package manifest at the root of a workspace', () => {
  const { stdout, base } = gateFor((dir) => {
    writeFile(dir, 'apps/web/package.json', '{}\n');
    writeFile(dir, 'packages/shared/package.json', '{}\n');
  });
  assert.equal(stdout, base);
});

test('bugfix: keeps the full gate when an untracked file in another workspace names a changed file', () => {
  const { stdout } = gateFor((dir) => {
    writeFile(dir, 'apps/mobile-admin/app.config.ts', 'export default {};\n');
    const base = rebaseOnto(dir);
    writeFile(
      dir,
      'apps/mobile-admin/app.config.ts',
      'export default { a: 1 };\n'
    );
    writeFile(
      dir,
      'apps/mobile-storefront/new.test.mjs',
      "resolve(root, 'apps/mobile-admin/app.config.ts');\n"
    );
    return base;
  });
  assert.equal(stdout, '');
});

test('stays scoped when an untracked file only names files in its own workspace', () => {
  const { stdout, base } = gateFor((dir) => {
    writeFile(dir, 'apps/web/src/b.ts', 'export const b = 1;\n');
    const base = rebaseOnto(dir);
    writeFile(dir, 'apps/web/src/b.ts', 'export const b = 2;\n');
    writeFile(dir, 'apps/web/src/new.test.ts', "read('apps/web/src/b.ts');\n");
    return base;
  });
  assert.equal(stdout, base);
});

// A mktemp that, like some BSD builds, rejects a call without a template.
function templateOnlyMktempEnv() {
  const real = execFileSync('sh', ['-c', 'command -v mktemp'], {
    encoding: 'utf8',
  }).trim();
  const bin = mkdtempSync(join(tmpdir(), 'qg-affected-mktemp-'));
  const stub = join(bin, 'mktemp');
  writeFileSync(
    stub,
    `#!/bin/sh\n[ "$#" -eq 0 ] && { echo 'usage: mktemp template' >&2; exit 1; }\nexec ${real} "$@"\n`
  );
  chmodSync(stub, 0o755);
  return { bin, env: { PATH: `${bin}:${process.env.PATH}` } };
}

test('bugfix: still scopes when mktemp requires a template argument', () => {
  const { bin, env } = templateOnlyMktempEnv();
  try {
    const { stdout, base } = gateFor((dir) => {
      writeFile(dir, 'apps/web/src/changed.ts');
    }, env);
    assert.equal(stdout, base);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});
