import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { NODE_PROJECT_TEST_GLOB } from '../../vitest.node-project-tests';

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const VITEST_BIN = path.join(
  path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs'
);
// An independent statement of the rule behind NODE_PROJECT_TEST_GLOB (no `x`:
// .tsx tests always stay in jsdom). It is deliberately not derived from the
// glob so that this test can catch a glob that drifts; the last test below
// checks that the two agree, including for file kinds this app has none of.
const NODE_PROJECT_TEST_FILE = /\.(test|spec)\.(c|m)?[jt]s$/;
const LIST_TIMEOUT_MS = 120_000;
const STDERR_EXCERPT_CHARS = 2_000;

type Spec = { project: string; file: string };
type ListedSpec = { file: string; projectName: string };

function isListedSpec(value: unknown): value is ListedSpec {
  if (typeof value !== 'object' || value === null) return false;
  const { file, projectName } = value as Partial<ListedSpec>;
  return typeof file === 'string' && typeof projectName === 'string';
}

function parseListedSpecs(stdout: string): Spec[] {
  const listed: unknown = JSON.parse(stdout);
  if (!Array.isArray(listed)) {
    throw new Error('`vitest list --json` did not print an array');
  }

  return listed.map((entry: unknown) => {
    if (!isListedSpec(entry)) {
      throw new Error(
        `unexpected \`vitest list --json\` entry: ${JSON.stringify(entry)}`
      );
    }
    return {
      project: entry.projectName,
      file: path.relative(APP_ROOT, entry.file),
    };
  });
}

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
    [VITEST_BIN, 'list', '--filesOnly', '--json'],
    {
      cwd: APP_ROOT,
      encoding: 'utf8',
      env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: LIST_TIMEOUT_MS - 10_000,
    }
  );

  // On a timeout or a failed spawn the status is null and the cause lives on
  // `result.error`; keep the stderr part of the message short.
  const failure = [
    result.error?.message,
    result.stderr?.slice(0, STDERR_EXCERPT_CHARS),
  ]
    .filter(Boolean)
    .join('\n');
  expect(result.status, failure || '`vitest list` did not finish').toBe(0);

  return parseListedSpecs(result.stdout);
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

describe('node project test file rule', () => {
  it.each([
    'a.test.ts',
    'a.spec.ts',
    'a.test.mts',
    'a.test.cts',
    'a.test.js',
    'a.spec.mjs',
    'dir/nested/a.test.ts',
    'a.test.tsx',
    'a.spec.tsx',
    'a.test.jsx',
    'a.test.ts.snap',
    'a.ts',
    'test.ts',
  ])('classifies %s the same way as the shared glob', (file) => {
    expect(NODE_PROJECT_TEST_FILE.test(file)).toBe(
      path.matchesGlob(file, NODE_PROJECT_TEST_GLOB)
    );
  });
});
