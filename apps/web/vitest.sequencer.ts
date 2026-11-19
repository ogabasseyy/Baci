import path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { SLOW_TEST_FILES_FIRST } from './vitest.slow-test-files';

const SLOW_FILE_ORDER: ReadonlyMap<string, number> = new Map(
  SLOW_TEST_FILES_FIRST.map((file, index) => [file, index])
);

function rootRelativePath(root: string, moduleId: string): string {
  return path.relative(root, moduleId).split(path.sep).join('/');
}

/**
 * Vitest's default sequencer with one change: the files listed in
 * vitest.slow-test-files.ts start first.
 *
 * Only `sort` is overridden. `shard` is inherited unchanged, so
 * `vitest run --shard=N/M` assigns every file to the same shard as before (sha1
 * of the root-relative path); the order below only applies inside a shard.
 *
 * The default `sort` orders by project name first (`jsdom`, `jsdom-holdouts`,
 * `node`), then by the cached result of the previous run or, with no cache
 * (CI), by file size, largest first. A small file in the `node` project
 * therefore starts after every `jsdom` file, however long its test runs.
 *
 * Sequencing is global (a project cannot set its own), so vitest.config.ts sets
 * this class once at the root of `test` and it covers every project. A
 * configured sequencer also makes Vitest ignore `--sequence.shuffle.files`.
 */
export class SlowFilesFirstSequencer extends BaseSequencer {
  override async sort(
    files: TestSpecification[]
  ): Promise<TestSpecification[]> {
    const defaultOrder = await super.sort(files);
    const slow: { spec: TestSpecification; rank: number }[] = [];
    const rest: TestSpecification[] = [];

    for (const spec of defaultOrder) {
      const rank = SLOW_FILE_ORDER.get(
        rootRelativePath(this.ctx.config.root, spec.moduleId)
      );

      if (rank === undefined) rest.push(spec);
      else slow.push({ spec, rank });
    }

    slow.sort((a, b) => a.rank - b.rank);

    return [...slow.map(({ spec }) => spec), ...rest];
  }
}
