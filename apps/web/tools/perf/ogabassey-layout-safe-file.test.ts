import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { readArtifactFile } from './ogabassey-layout-safe-file';

it('reads regular files and rejects traversal and symbolic links', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'layout-safe-'));
  await writeFile(path.join(root, 'ok'), 'value');
  await symlink(path.join(root, 'ok'), path.join(root, 'link'));
  expect((await readArtifactFile(root, 'ok')).toString()).toBe('value');
  await expect(readArtifactFile(root, '../ok')).rejects.toThrow(
    /invalid artifact path/i
  );
  await expect(readArtifactFile(root, 'link')).rejects.toThrow(/symlink/i);
});
