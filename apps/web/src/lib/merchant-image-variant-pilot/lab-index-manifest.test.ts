import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENERATION_ID, setupLab } from './lab-index-fixtures';
import { loadBindingManifest } from './lab-index-manifest';

describe('loadBindingManifest', () => {
  it('loads a valid manifest and rejects unsafe or missing generation manifests', async () => {
    const lab = await setupLab();
    try {
      const okResult = await loadBindingManifest({
        binding: lab.bindings[0],
        generationId: GENERATION_ID,
        outputRoot: lab.outputRoot,
      });
      expect(okResult.ok).toBe(true);

      const unsafeResult = await loadBindingManifest({
        binding: lab.bindings[0],
        generationId: '../escape',
        outputRoot: lab.outputRoot,
      });
      expect(unsafeResult).toEqual({
        detail: 'acceptance references an unsafe generation id',
        ok: false,
        status: 'invalid-manifest',
      });

      const missingResult = await loadBindingManifest({
        binding: lab.bindings[0],
        generationId: '0'.repeat(64),
        outputRoot: lab.outputRoot,
      });
      expect(missingResult).toEqual({
        generationId: '0'.repeat(64),
        ok: false,
        status: 'missing-manifest',
      });
    } finally {
      await rm(join(lab.outputRoot, '..'), { force: true, recursive: true });
    }
  });
});
