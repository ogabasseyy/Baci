import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertMeasurementOutputPath } from './assert-measurement-output-path';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('assertMeasurementOutputPath', () => {
  it('bugfix: rejects --out paths that alias an evidence input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-alias-'));
    roots.push(root);
    const beforePath = join(root, 'before.jsonl');
    await writeFile(beforePath, '{}\n');

    await expect(
      assertMeasurementOutputPath(beforePath, [beforePath])
    ).rejects.toThrow('measurement --out must not overwrite an input path');
  });
});
