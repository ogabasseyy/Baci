import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BaseSequencer,
  type TestSpecification,
  type Vitest,
} from 'vitest/node';
import { SlowFilesFirstSequencer } from '../../vitest.sequencer';
import { SLOW_TEST_FILES_FIRST } from '../../vitest.slow-test-files';

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));
// The fakes below use their own root: the sequencer must work from the root
// Vitest reports, not from this checkout.
const ROOT = '/repo/apps/web';
const SHARD_COUNT = 6;

type Shard = { index: number; count: number };

// The slice of Vitest the sequencers read: the root, the shard and the results
// cache. `sizes` are the file sizes the default sort falls back to when the
// cache has no result for a file, which is how CI starts.
function fakeContext(sizes: Map<string, number>, shard?: Shard): Vitest {
  return {
    config: { root: ROOT, shard },
    cache: {
      getFileTestResults: () => undefined,
      getFileStats: (key: string) => {
        const size = sizes.get(key);

        return size === undefined ? undefined : { size };
      },
    },
  } as unknown as Vitest;
}

function fakeSpec(project: string, file: string): TestSpecification {
  return {
    moduleId: `${ROOT}/${file}`,
    project: {
      name: project,
      config: { isolate: true, sequence: { groupOrder: 0 } },
    },
  } as unknown as TestSpecification;
}

const files = (specs: TestSpecification[]) =>
  specs.map((spec) => path.posix.relative(ROOT, spec.moduleId));

const isListed = (file: string) => SLOW_TEST_FILES_FIRST.includes(file);

// Ordinary files in all three projects, plus every listed file in the `node`
// project, given in reverse list order and as the smallest files, which is
// where the default order puts them.
function mixedSpecs() {
  const sizes = new Map<string, number>();
  const specs: TestSpecification[] = [];
  const add = (project: string, file: string, size: number) => {
    sizes.set(`${project}:${file}`, size);
    specs.push(fakeSpec(project, file));
  };

  add('jsdom', 'src/components/Card.test.tsx', 900);
  add('jsdom', 'src/components/Button.test.tsx', 100);
  add('jsdom-holdouts', 'src/app/dashboard/use-hook.test.ts', 50);
  add('node', 'src/lib/large.test.ts', 5000);
  add('node', 'src/lib/small.test.ts', 10);
  for (const file of [...SLOW_TEST_FILES_FIRST].reverse()) add('node', file, 1);

  return { specs, sizes };
}

describe('SlowFilesFirstSequencer', () => {
  it('starts the listed files first, in list order, before every project and size', async () => {
    const { specs, sizes } = mixedSpecs();

    const sorted = await new SlowFilesFirstSequencer(fakeContext(sizes)).sort(
      specs
    );

    expect(files(sorted).slice(0, SLOW_TEST_FILES_FIRST.length)).toEqual(
      SLOW_TEST_FILES_FIRST
    );
  });

  it('leaves every other file in exactly the default order', async () => {
    const { specs, sizes } = mixedSpecs();
    const context = fakeContext(sizes);

    const sorted = await new SlowFilesFirstSequencer(context).sort(specs);
    const defaultOrder = await new BaseSequencer(context).sort(specs);

    expect(files(sorted).slice(SLOW_TEST_FILES_FIRST.length)).toEqual(
      files(defaultOrder).filter((file) => !isListed(file))
    );
    // Guards the premise: the default order puts the node project last.
    expect(files(defaultOrder).slice(0, 3)).toEqual([
      'src/components/Card.test.tsx',
      'src/components/Button.test.tsx',
      'src/app/dashboard/use-hook.test.ts',
    ]);
  });

  it('returns every file exactly once', async () => {
    const { specs, sizes } = mixedSpecs();

    const sorted = await new SlowFilesFirstSequencer(fakeContext(sizes)).sort(
      specs
    );

    expect(sorted).toHaveLength(specs.length);
    expect(new Set(sorted)).toEqual(new Set(specs));
  });

  it('leaves the default order alone when no listed file is in the run', async () => {
    const { specs, sizes } = mixedSpecs();
    const context = fakeContext(sizes);
    const unlisted = specs.filter((spec) => !isListed(files([spec])[0] ?? ''));

    const sorted = await new SlowFilesFirstSequencer(context).sort(unlisted);

    expect(files(sorted)).toEqual(
      files(await new BaseSequencer(context).sort(unlisted))
    );
  });

  it('orders a partial selection by list order, in whichever project a file sits', async () => {
    const [first, , third] = SLOW_TEST_FILES_FIRST;
    const specs = [
      fakeSpec('node', 'src/lib/large.test.ts'),
      fakeSpec('jsdom', third ?? ''),
      fakeSpec('node', first ?? ''),
    ];
    const sizes = new Map([
      ['node:src/lib/large.test.ts', 5000],
      [`jsdom:${third}`, 1],
      [`node:${first}`, 1],
    ]);

    const sorted = await new SlowFilesFirstSequencer(fakeContext(sizes)).sort(
      specs
    );

    expect(files(sorted)).toEqual([first, third, 'src/lib/large.test.ts']);
  });

  it('matches paths against the Vitest root, so a same-named file elsewhere is not slow', async () => {
    const [first] = SLOW_TEST_FILES_FIRST;
    const nested = `src/${first}`;
    const specs = [
      fakeSpec('node', 'src/lib/large.test.ts'),
      fakeSpec('node', nested),
    ];
    const sizes = new Map([
      ['node:src/lib/large.test.ts', 5000],
      [`node:${nested}`, 1],
    ]);
    const context = fakeContext(sizes);

    const sorted = await new SlowFilesFirstSequencer(context).sort(specs);

    expect(files(sorted)).toEqual(
      files(await new BaseSequencer(context).sort(specs))
    );
    expect(files(sorted)).toEqual(['src/lib/large.test.ts', nested]);
  });

  describe('sharding', () => {
    // The CI shards (`vitest run --shard=N/6`) must keep holding exactly the
    // files they held before the sequencer existed.
    const { specs: mixed } = mixedSpecs();
    const generated = Array.from({ length: 600 }, (_, index) =>
      fakeSpec(
        index % 4 === 0 ? 'jsdom' : 'node',
        `src/generated/file-${index}.test.ts`
      )
    );
    const allSpecs = [...mixed, ...generated];
    const shards = Array.from({ length: SHARD_COUNT }, (_, i) => i + 1);

    it('does not override shard()', () => {
      expect(Object.hasOwn(SlowFilesFirstSequencer.prototype, 'shard')).toBe(
        false
      );
      expect(SlowFilesFirstSequencer.prototype.shard).toBe(
        BaseSequencer.prototype.shard
      );
    });

    it.each(
      shards
    )('puts the same files in shard %i/6 as the default sequencer', async (index) => {
      const context = fakeContext(new Map(), { index, count: SHARD_COUNT });

      const ours = await new SlowFilesFirstSequencer(context).shard([
        ...allSpecs,
      ]);
      const theirs = await new BaseSequencer(context).shard([...allSpecs]);

      expect(files(ours)).toEqual(files(theirs));
      expect(ours.length).toBeGreaterThan(0);
    });

    it('puts every file in exactly one shard', async () => {
      const assigned: string[] = [];

      for (const index of shards) {
        const context = fakeContext(new Map(), { index, count: SHARD_COUNT });
        const shard = await new SlowFilesFirstSequencer(context).shard([
          ...allSpecs,
        ]);

        assigned.push(...files(shard));
      }

      expect(assigned.sort()).toEqual(files(allSpecs).sort());
    });
  });

  it('is the sequencer vitest.config.ts sets once, at the root of test', () => {
    // Read as text: importing the config here costs about 8 s of transform,
    // because the config pulls in the React plugin. Vitest ignores a sequencer
    // set inside a project, so only a direct child of `test` (four spaces of
    // indent) counts; if it is dropped the slow files go back to the end.
    const source = readFileSync(
      path.join(WEB_ROOT, 'vitest.config.ts'),
      'utf8'
    );

    expect(source).toContain(
      "import { SlowFilesFirstSequencer } from './vitest.sequencer';"
    );
    expect(source).toMatch(
      /^ {4}sequence: \{ sequencer: SlowFilesFirstSequencer \},$/m
    );
  });
});

describe('vitest.slow-test-files list', () => {
  it('lists at least one file', () => {
    expect(SLOW_TEST_FILES_FIRST.length).toBeGreaterThan(0);
  });

  it.each(
    SLOW_TEST_FILES_FIRST
  )('lists %s as a plain relative path to an existing test file', (file) => {
    // A renamed or mistyped entry would match nothing and silently put the
    // slow test back at the end of its shard.
    expect(file).toMatch(/\.(test|spec)\.(c|m)?[jt]sx?$/);
    expect(file).not.toMatch(/^(\.{0,2}\/|\/)/);
    expect(file).not.toContain('\\');
    expect(statSync(path.join(WEB_ROOT, file)).isFile()).toBe(true);
  });

  it('lists each file once', () => {
    expect(new Set(SLOW_TEST_FILES_FIRST).size).toBe(
      SLOW_TEST_FILES_FIRST.length
    );
  });
});
