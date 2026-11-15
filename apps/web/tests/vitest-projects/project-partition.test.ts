import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM_HOLDOUT_FILES } from '../../vitest.jsdom-holdouts';
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

function expectedProject(file: string): string {
  if (JSDOM_HOLDOUT_FILES.includes(file)) return 'jsdom-holdouts';

  const inNodeFolder =
    NODE_PROJECT_TEST_FILE.test(file) &&
    NODE_PROJECT_FOLDERS.some((folder) => file.startsWith(`${folder}/`));

  return inNodeFolder ? 'node' : 'jsdom';
}

// Expected cost: one `vitest list` of the whole suite (about 2-3 s), run once in
// beforeAll. It is the only check that sees the real file-to-project assignment,
// so it deliberately runs everywhere instead of being skipped locally.
//
// The CI shards (`vitest run --shard=N/6`) split the combined list of both
// projects by file path, so they only cover every test exactly once if every
// file belongs to exactly one project.
describe('node/jsdom Vitest project partition', () => {
  let specs: Spec[] = [];

  beforeAll(() => {
    specs = listSpecs();
  }, LIST_TIMEOUT_MS);

  it('defines exactly the node, jsdom and jsdom-holdouts projects, all with tests', () => {
    expect(new Set(specs.map((spec) => spec.project))).toEqual(
      new Set(['node', 'jsdom', 'jsdom-holdouts'])
    );
  });

  it('runs every test file in exactly one project', () => {
    const files = specs.map((spec) => spec.file);

    expect(new Set(files).size).toBe(files.length);
  });

  it('puts every file in the project its folder and the holdout list call for', () => {
    const misplaced = specs
      .filter((spec) => spec.project !== expectedProject(spec.file))
      .map((spec) => `[${spec.project}] ${spec.file}`);

    expect(misplaced).toEqual([]);
  });

  it.each(JSDOM_HOLDOUT_FILES)('runs holdout %s in jsdom-holdouts', (file) => {
    expect(
      specs.some(
        (spec) => spec.project === 'jsdom-holdouts' && spec.file === file
      )
    ).toBe(true);
  });

  it.each(NODE_PROJECT_FOLDERS)('finds tests in node folder %s', (folder) => {
    expect(
      specs.some(
        (spec) => spec.project === 'node' && spec.file.startsWith(`${folder}/`)
      )
    ).toBe(true);
  });
});
