import { expect, it } from 'vitest';
import { diffSourceFiles, pageSourceMetadata } from './source-inspection';

it('paginates file/diff metadata without embedding private source or megabyte responses', () => {
  const files = Array.from({ length: 20 }, (_, i) => ({
    path: `file${i}.tsx`,
    content: 'PRIVATE_SOURCE_SENTINEL',
  }));
  const page = pageSourceMetadata(files, 0, 16);
  expect(page.files).toHaveLength(16);
  expect(page.nextCursor).toBe(16);
  expect(JSON.stringify(page)).not.toContain('PRIVATE_SOURCE_SENTINEL');
  const diff = diffSourceFiles(
    [
      { path: 'old', content: 'a' },
      { path: 'same', content: 'x' },
    ],
    [
      { path: 'new', content: 'b' },
      { path: 'same', content: 'y' },
    ]
  );
  expect(diff.map((d) => d.change).sort()).toEqual([
    'added',
    'changed',
    'removed',
  ]);
});
