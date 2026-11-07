import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeEvidenceAtomically } from './atomic-evidence-write';

describe('atomic evidence writes', () => {
  it('writes through a unique owned temporary file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-atomic-'));
    const outputPath = join(directory, 'receipt.json');

    await writeEvidenceAtomically(outputPath, '{"contractVersion":1}');

    expect(await readFile(outputPath, 'utf8')).toBe('{"contractVersion":1}');
    expect(await readdir(directory)).toEqual(['receipt.json']);
  });

  it('cleans only its owned temporary file when rename fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chowdeck-atomic-'));
    const outputPath = join(directory, 'destination');
    const predictablePath = `${outputPath}.tmp`;
    await mkdir(outputPath);
    await writeFile(predictablePath, 'pre-existing', 'utf8');

    await expect(writeEvidenceAtomically(outputPath, '{}')).rejects.toThrow();

    expect(await readFile(predictablePath, 'utf8')).toBe('pre-existing');
    expect((await readdir(directory)).sort()).toEqual([
      'destination',
      'destination.tmp',
    ]);
  });
});
