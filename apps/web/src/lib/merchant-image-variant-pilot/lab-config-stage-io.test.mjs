import { describe, expect, it } from 'vitest';
import { MAX_INPUT_BYTES } from '../../../../../infra/cdn-transformer/pilot/constants.mjs';

// The staged snapshot read bounds the same cap the generator enforces.
// Web runtime code must not import infra directly, so the limit is
// mirrored in lab-config-stage-io.ts; this pins the two together.
describe('staged snapshot cap parity', () => {
  it('matches the transformer input cap', async () => {
    const { readFile } = await import('node:fs/promises');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const source = await readFile(join(here, 'lab-config-stage-io.ts'), 'utf8');
    const match = source.match(
      /MAX_STAGED_SNAPSHOT_BYTES = (\d+) \* 1024 \* 1024/
    );
    expect(match).not.toBe(null);
    expect(Number(match?.[1]) * 1024 * 1024).toBe(MAX_INPUT_BYTES);
  });
});
