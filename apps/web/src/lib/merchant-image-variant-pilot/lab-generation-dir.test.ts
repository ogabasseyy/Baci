import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LabGenerationConfinementError,
  resolveLabGenerationDir,
} from './lab-generation-dir';

const GENERATION_ID = 'a'.repeat(64);

async function setupOutputRoot() {
  const outputRoot = join(
    tmpdir(),
    `pilot-gen-dir-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(join(outputRoot, 'generations'), { recursive: true });
  return outputRoot;
}

describe('resolveLabGenerationDir', () => {
  it('resolves a confined generation directory', async () => {
    const outputRoot = await setupOutputRoot();
    const dir = join(outputRoot, 'generations', GENERATION_ID);
    await mkdir(dir);
    await expect(
      resolveLabGenerationDir(outputRoot, GENERATION_ID)
    ).resolves.toBe(dir);
  });

  it('reports missing ids and absent entries as generation-missing', async () => {
    const outputRoot = await setupOutputRoot();
    for (const generationId of [
      'not-an-id',
      '../escape',
      'g'.repeat(64),
      GENERATION_ID,
    ]) {
      const error = await resolveLabGenerationDir(
        outputRoot,
        generationId
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LabGenerationConfinementError);
      expect((error as LabGenerationConfinementError).code).toBe(
        'generation-missing'
      );
    }
  });

  it('rejects non-directory entries as escapes', async () => {
    const outputRoot = await setupOutputRoot();
    await writeFile(
      join(outputRoot, 'generations', GENERATION_ID),
      'not a directory'
    );
    const error = await resolveLabGenerationDir(
      outputRoot,
      GENERATION_ID
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LabGenerationConfinementError);
    expect((error as LabGenerationConfinementError).code).toBe(
      'generation-escape'
    );
  });

  it('rejects symlinks escaping the output root', async () => {
    const outputRoot = await setupOutputRoot();
    const outside = join(
      tmpdir(),
      `pilot-gen-outside-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(outputRoot, 'generations', GENERATION_ID));
    const error = await resolveLabGenerationDir(
      outputRoot,
      GENERATION_ID
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LabGenerationConfinementError);
    expect((error as LabGenerationConfinementError).code).toBe(
      'generation-escape'
    );
  });

  it('rejects a symlinked generations root', async () => {
    const outputRoot = join(
      tmpdir(),
      `pilot-gen-root-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(outputRoot, { recursive: true });
    const outside = join(
      tmpdir(),
      `pilot-gen-rout-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(join(outside, GENERATION_ID), { recursive: true });
    await symlink(outside, join(outputRoot, 'generations'));
    const error = await resolveLabGenerationDir(
      outputRoot,
      GENERATION_ID
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LabGenerationConfinementError);
    expect((error as LabGenerationConfinementError).code).toBe(
      'generation-escape'
    );
  });
});
