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

  it('rejects a pin with duplicate keys instead of collapsing them', async () => {
    // [A, A] against inventory [A]: the Set comparison would pass while
    // a planned binding went missing from the matrix.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-offline-sample-'));
    const pin = join(dir, 'pin.json');
    await writeFile(pin, JSON.stringify(['m/a/slot', 'm/a/slot']));
    const checks = [];
    const failures = [];
    const ok = await checkSamplePin({
      checks,
      expectSample: pin,
      failures,
      inventory: [{ assetId: 'a', merchantId: 'm', slot: 'slot' }],
    });
    expect(ok).toBe(false);
    expect(failures.join('\n')).toMatch(/duplicate bindings: m\/a\/slot/);
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
