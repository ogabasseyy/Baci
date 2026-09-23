import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeMeasurementReport } from './write-measurement-report';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('writeMeasurementReport', () => {
  it('replaces an existing permissive output with a private report file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vercel-cost-report-'));
    roots.push(root);
    const outputPath = join(root, 'measurement.json');
    await writeFile(outputPath, 'old', { mode: 0o644 });
    await chmod(outputPath, 0o644);

    await writeMeasurementReport(outputPath, '{"safe":true}\n');

    expect(await readFile(outputPath, 'utf8')).toBe('{"safe":true}\n');
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
  });
});
