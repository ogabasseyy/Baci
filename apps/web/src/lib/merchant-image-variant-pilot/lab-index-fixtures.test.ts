import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GENERATION_ID,
  MERCHANT,
  SOURCE,
  setupLab,
} from './lab-index-fixtures';

describe('lab-index-fixtures', () => {
  it('exports fixture constants and writes a populated generation directory', async () => {
    expect(MERCHANT).toBe('6b5cb8a4-5575-456c-b936-8cdfae30db74');
    expect(SOURCE).toMatch(/^[0-9a-f]{64}$/);
    expect(GENERATION_ID).toMatch(/^[0-9a-f]{64}$/);

    const lab = await setupLab();
    try {
      expect(lab.bindings).toHaveLength(1);
      expect(lab.tiers).toHaveLength(6);
      await expect(
        access(join(lab.generationDir, 'manifest.json'))
      ).resolves.toBeUndefined();
    } finally {
      await rm(join(lab.outputRoot, '..'), { force: true, recursive: true });
    }
  });
});
