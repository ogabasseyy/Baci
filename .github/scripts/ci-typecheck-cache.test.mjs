import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const require = createRequire(import.meta.url);
const compiler = require.resolve('typescript-tsserver/bin/tsc');
const actionUrl = new URL(
  '../actions/typecheck-cache/action.yml',
  import.meta.url,
);
const configs = [
  'tsconfig.tools-workers.json',
  'tsconfig.mcp.json',
  'tsconfig.builder-mcp.json',
  'tsconfig.builder-publication.json',
];

test('all web typecheck programs have distinct incremental state files', () => {
  const state = new Set(['tsconfig.tsbuildinfo']);
  for (const name of configs) {
    const config = JSON.parse(
      readFileSync(new URL(`../../apps/web/${name}`, import.meta.url), 'utf8'),
    );
    assert.equal(config.compilerOptions.incremental, true, name);
    assert.notEqual(
      config.compilerOptions.assumeChangesOnlyAffectDirectDependencies,
      true,
    );
    const path = config.compilerOptions.tsBuildInfoFile;
    assert.equal(path, name.replace('.json', '.tsbuildinfo'));
    assert.ok(!state.has(path), 'programs must never share compiler state');
    state.add(path);
  }
});

test('compiler cache is restore-only for PRs and never replaces typecheck execution', () => {
  assert.ok(existsSync(actionUrl), 'missing compiler-cache action');
  const action = parse(readFileSync(actionUrl, 'utf8'));
  const restore = action.runs.steps.find((step) => step.id === 'restore');
  const save = action.runs.steps.find((step) => step.id === 'save');
  assert.match(restore.uses, /^actions\/download-artifact@[a-f0-9]{40}$/);
  assert.match(save.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/);
  assert.match(save.if, /github.event_name == 'push'/);
  assert.match(save.if, /github.ref == 'refs\/heads\/main'/);
  assert.equal(restore.with.path, 'apps/web');
  assert.equal(save.with.path, 'apps/web/*.tsbuildinfo');
  assert.match(
    restore.with['artifact-ids'],
    /steps.source.outputs.artifact-id/,
  );
  assert.match(restore.with['run-id'], /steps.source.outputs.run-id/);
  assert.match(save.with.name, /hashFiles\(/);
  const source = action.runs.steps.find((step) => step.id === 'source');
  assert.equal(
    save.with.name,
    source.env.TYPECHECK_ARTIFACT_NAME,
    'save and restore must derive the same compatibility key',
  );
  assert.equal(save.with['retention-days'], 3);
  const ci = parse(
    readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8'),
  );
  const steps = ci.jobs['quality-typecheck'].steps;
  const runIndex = steps.findIndex((step) => step.name === 'Run Typecheck');
  const restoreIndex = steps.findIndex((step) => step.id === 'typecheck-cache');
  const saveIndex = steps.findIndex(
    (step) => step.name === 'Save TypeScript compiler state',
  );
  assert.ok(
    restoreIndex >= 0 && restoreIndex < runIndex && runIndex < saveIndex,
  );
  assert.equal(
    steps[runIndex].if,
    undefined,
    'cache hits must not skip the typecheck command',
  );
  assert.match(steps[runIndex].run, /pnpm turbo typecheck --affected/);
});

for (const scenario of [
  'imported source',
  'compiler options',
  'corrupted state',
]) {
  test(`warm TypeScript state still rejects errors after changing ${scenario}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'baci-ts-incremental-'));
    try {
      const config = {
        compilerOptions: {
          strict: true,
          noEmit: true,
          incremental: true,
          tsBuildInfoFile: 'state.tsbuildinfo',
          types: [],
          target: 'es2022',
          module: 'commonjs',
        },
        include: ['*.ts'],
      };
      writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(config));
      writeFileSync(
        join(root, 'model.ts'),
        'export const amount: number = 42;\n',
      );
      writeFileSync(
        join(root, 'consumer.ts'),
        "import { amount } from './model';\nconst unused = 1;\nexport const total: number = amount;\n",
      );
      const run = () =>
        spawnSync(
          process.execPath,
          [compiler, '-p', root, '--pretty', 'false'],
          { cwd: root, encoding: 'utf8' },
        );
      const cold = run();
      assert.equal(cold.status, 0, cold.stdout + cold.stderr);
      assert.ok(existsSync(join(root, 'state.tsbuildinfo')));
      assert.equal(run().status, 0, 'unchanged warm program must pass');
      if (scenario === 'compiler options') {
        config.compilerOptions.noUnusedLocals = true;
        writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(config));
      } else {
        writeFileSync(
          join(root, 'model.ts'),
          "export const amount: string = 'wrong';\n",
        );
        if (scenario === 'corrupted state')
          writeFileSync(join(root, 'state.tsbuildinfo'), 'invalid');
      }
      const changed = run();
      assert.notEqual(
        changed.status,
        0,
        'cached compiler state must not produce false success',
      );
      assert.match(
        changed.stdout + changed.stderr,
        scenario === 'compiler options' ? /TS6133/ : /TS2322/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
