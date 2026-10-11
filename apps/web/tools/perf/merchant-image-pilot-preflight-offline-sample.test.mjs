import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSamplePin } from './merchant-image-pilot-preflight-offline-sample.mjs';

describe('checkSamplePin', () => {
  it('fails closed on an oversized expect-sample file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-offline-sample-'));
    const giant = join(dir, 'giant.json');
    await writeFile(giant, Buffer.alloc(1024 * 1024 + 1, 0x5b));
    const checks = [];
    const failures = [];
    const ok = await checkSamplePin({
      checks,
      expectSample: giant,
      failures,
      inventory: [],
    });
    expect(ok).toBe(false);
    expect(failures.join('\n')).toMatch(/byte budget/);
  });

  it('fails closed on a missing expect-sample file', async () => {
    const checks = [];
    const failures = [];
    const ok = await checkSamplePin({
      checks,
      expectSample: join(
        await mkdtemp(join(tmpdir(), 'pilot-offline-sample-')),
        'missing.json'
      ),
      failures,
      inventory: [],
    });
    expect(ok).toBe(false);
    expect(failures.join('\n')).toMatch(/cannot read expect-sample/);
  });
});
