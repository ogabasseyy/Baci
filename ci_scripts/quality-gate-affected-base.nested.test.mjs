import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gateFor,
  rebaseOnto,
  writeFile,
} from './quality-gate-affected-base.test-helpers.mjs';

// A pnpm-workspace.yaml that declares nested workspaces under apps/web: Turbo
// maps a file there to the nested package, not to apps/web, so the
// two-path-segment ownership check cannot be trusted for them.
const NESTED_WORKSPACE_YAML = `packages:
  - "apps/*"
  - packages/*
  - 'apps/web/mcp-server/widgets' # nested, quoted, with a comment
  - apps/web/tools/*
  - '!**/test/**'
minimumReleaseAgeExclude:
  - apps/web/not-a-workspace
`;

function nestedSetup(dir, setup) {
  writeFile(dir, 'pnpm-workspace.yaml', NESTED_WORKSPACE_YAML);
  writeFile(dir, 'apps/web/src/b.ts', 'export const b = 1;\n');
  const base = rebaseOnto(dir);
  setup(dir);
  return base;
}

test('bugfix: keeps the full gate for a change inside a nested workspace', () => {
  const { stdout } = gateFor((dir) =>
    nestedSetup(dir, (d) =>
      writeFile(d, 'apps/web/mcp-server/widgets/src/index.tsx')
    )
  );
  assert.equal(stdout, '');
});

test('bugfix: keeps the full gate for a nested workspace declared with a wildcard', () => {
  const { stdout } = gateFor((dir) =>
    nestedSetup(dir, (d) => writeFile(d, 'apps/web/tools/builder/index.ts'))
  );
  assert.equal(stdout, '');
});

test('bugfix: keeps the full gate when a nested workspace file names a changed parent file', () => {
  const { stdout } = gateFor((dir) => {
    writeFile(dir, 'pnpm-workspace.yaml', NESTED_WORKSPACE_YAML);
    writeFile(dir, 'apps/web/src/b.ts', 'export const b = 1;\n');
    writeFile(
      dir,
      'apps/web/mcp-server/widgets/b.test.ts',
      "read('apps/web/src/b.ts');\n"
    );
    const base = rebaseOnto(dir);
    writeFile(dir, 'apps/web/src/b.ts', 'export const b = 2;\n');
    return base;
  });
  assert.equal(stdout, '');
});

test('stays scoped for the parent workspace and for paths only listed under other yaml keys', () => {
  const { stdout, base } = gateFor((dir) =>
    nestedSetup(dir, (d) => {
      writeFile(d, 'apps/web/src/b.ts', 'export const b = 2;\n');
      writeFile(d, 'apps/web/not-a-workspace/x.ts');
    })
  );
  assert.equal(stdout, base);
});

test('stays scoped without a pnpm-workspace.yaml', () => {
  const { stdout, base } = gateFor((dir) => {
    writeFile(dir, 'apps/web/mcp-server/widgets/src/index.tsx');
  });
  assert.equal(stdout, base);
});
