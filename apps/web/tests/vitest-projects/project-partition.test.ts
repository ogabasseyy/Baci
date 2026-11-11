import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { NODE_PROJECT_FOLDERS } from '../../vitest.node-folders';

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));
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
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith('VITEST') && key !== 'TEST'
    )
  );
  const result = spawnSync(
    process.execPath,
    [VITEST_BIN, 'list', '--filesOnly'],
    {
      cwd: WEB_ROOT,
      encoding: 'utf8',
      env,
      maxBuffer: 128 * 1024 * 1024,
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

function belongsToNodeProject(file: string): boolean {
  return (
    NODE_PROJECT_TEST_FILE.test(file) &&
    NODE_PROJECT_FOLDERS.some((folder) => file.startsWith(`${folder}/`))
  );
}

// The CI shards (`vitest run --shard=N/6`) split the combined list of both
// projects by file path, so they only cover every test exactly once if every
// file belongs to exactly one project.
describe('node/jsdom Vitest project partition', () => {
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

  it('puts a file in the node project exactly when its folder is listed', () => {
    const misplaced = specs
      .filter(
        (spec) => (spec.project === 'node') !== belongsToNodeProject(spec.file)
      )
      .map((spec) => `[${spec.project}] ${spec.file}`);

    expect(misplaced).toEqual([]);
  });

  it.each(NODE_PROJECT_FOLDERS)('finds tests in node folder %s', (folder) => {
    expect(
      specs.some(
        (spec) => spec.project === 'node' && spec.file.startsWith(`${folder}/`)
      )
    ).toBe(true);
  });
});
