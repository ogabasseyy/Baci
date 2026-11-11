import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const VITEST_BIN = path.join(
  path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs'
);
// Same shape vitest.config.ts uses for the node project (no `x`: .tsx tests
// always stay in jsdom).
const NODE_PROJECT_TEST_FILE = /\.(test|spec)\.(c|m)?[jt]s$/;
const LIST_TIMEOUT_MS = 120_000;

type Spec = { project: string; file: string };

function listSpecs(): Spec[] {
  // A fresh Vitest must not believe it is nested inside this test's worker.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITEST') || key === 'TEST') {
      Reflect.deleteProperty(env, key);
    }
  }
  const result = spawnSync(
    process.execPath,
    [VITEST_BIN, 'list', '--filesOnly'],
    {
      cwd: APP_ROOT,
      encoding: 'utf8',
      env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: LIST_TIMEOUT_MS - 10_000,
    }
  );

  expect(result.status, result.stderr).toBe(0);

  return result.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const match = /^\[([^\]]+)\] (.+)$/.exec(line);
      expect(match, `unexpected \`vitest list\` line: ${line}`).not.toBeNull();
      return { project: match?.[1] ?? '', file: match?.[2] ?? '' };
    });
}

// Expected cost: one `vitest list` of the whole suite, run once in beforeAll.
// It is the only check that sees the real file-to-project assignment, so it
// deliberately runs everywhere instead of being skipped locally.
describe('mobile admin node/jsdom Vitest project partition', () => {
  let specs: Spec[] = [];

  beforeAll(() => {
    specs = listSpecs();
  }, LIST_TIMEOUT_MS);

  it('defines exactly the node and jsdom projects, both with tests', () => {
    expect(new Set(specs.map((spec) => spec.project))).toEqual(
      new Set(['node', 'jsdom'])
    );
  });

  it('runs every test file in exactly one project', () => {
    const files = specs.map((spec) => spec.file);

    expect(new Set(files).size).toBe(files.length);
  });

  it('runs plain .ts tests in node and everything else in jsdom', () => {
    const misplaced = specs
      .filter(
        (spec) =>
          spec.project !==
          (NODE_PROJECT_TEST_FILE.test(spec.file) ? 'node' : 'jsdom')
      )
      .map((spec) => `[${spec.project}] ${spec.file}`);

    expect(misplaced).toEqual([]);
  });

  it('keeps the component tests in jsdom', () => {
    const componentTests = specs.filter((spec) => spec.file.endsWith('.tsx'));

    expect(componentTests.length).toBeGreaterThan(0);
    expect(componentTests.every((spec) => spec.project === 'jsdom')).toBe(true);
  });
});
