import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readBoundedLabJson } from './lab-bounded-json';

it('accepts the exact budget and rejects overflow before JSON decoding', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-json-'));
  try {
    const path = join(dir, 'manifest.json');
    await writeFile(path, '{}');
    expect(await readBoundedLabJson(path, 2)).toBe('{}');
    await writeFile(path, '{} ');
    await expect(readBoundedLabJson(path, 2)).rejects.toThrow(/byte budget/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
