// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

import { readGitIndexSources } from './event-pipeline-git-content';

let root: string | undefined;
beforeEach(async () => {
  const actual =
    await vi.importActual<typeof import('node:child_process')>(
      'node:child_process'
    );
  vi.mocked(execFileSync).mockReset().mockImplementation(actual.execFileSync);
});
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});
it('reads duplicate blobs and newline paths using one bounded Git batch', () => {
  root = mkdtempSync(join(tmpdir(), 'event-index-batch-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const paths = ['first.ts', 'line\nbreak.ts'];
  for (const path of paths)
    writeFileSync(join(root, path), 'export const same = true;');
  execFileSync('git', ['--literal-pathspecs', 'add', '--', ...paths], {
    cwd: root,
  });
  vi.mocked(execFileSync).mockClear();
  const sources = readGitIndexSources(root, paths);
  expect(paths.map((path) => sources.get(path))).toEqual([
    'export const same = true;',
    'export const same = true;',
  ]);
  const batches = vi
    .mocked(execFileSync)
    .mock.calls.filter(
      ([, args]) => Array.isArray(args) && args[0] === 'cat-file'
    );
  expect(batches).toHaveLength(1);
  expect(batches[0][1]).toContain('--batch');
});
it.each([
  'truncated',
  'wrong-object',
  'trailing-bytes',
])('rejects %s index-blob framing', (kind) => {
  const hash = '1'.repeat(40);
  const header = kind === 'wrong-object' ? '2'.repeat(40) : hash;
  const bytes =
    kind === 'truncated'
      ? `${header} blob 5\nx`
      : `${header} blob 1\nx\n${kind === 'trailing-bytes' ? 'extra' : ''}`;
  vi.mocked(execFileSync)
    .mockReturnValueOnce(
      `100644 ${hash} 0\tfile.ts\0` as unknown as ReturnType<
        typeof execFileSync
      >
    )
    .mockReturnValueOnce(
      Buffer.from(bytes) as unknown as ReturnType<typeof execFileSync>
    );
  expect(() => readGitIndexSources('/synthetic', ['file.ts'])).toThrow();
});
