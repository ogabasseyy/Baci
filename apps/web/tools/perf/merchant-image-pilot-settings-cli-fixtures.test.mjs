import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  browserProvenanceArg,
  DATED_PAGE,
  pngBuffer,
  provenanceArg,
  ROUTE,
  runWithEntries,
  screenshotProvenanceArg,
} from './merchant-image-pilot-settings-cli-fixtures.mjs';

describe('merchant-image-pilot-settings-cli-fixtures', () => {
  it('writes provenance CLI arguments and executes settings CLI via runWithEntries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-cli-fix-'));
    const bytes = await pngBuffer(48, 48);
    expect(ROUTE).toContain('/pilot-lab/store/ogabassey');
    expect(DATED_PAGE._url).toBe(ROUTE);

    const cacheArg = await provenanceArg(dir);
    expect(cacheArg).toMatch(/^--cache-provenance=/);

    const shotArg = await screenshotProvenanceArg(dir, bytes);
    expect(shotArg).toMatch(/^--screenshot-provenance=/);

    const browserArg = await browserProvenanceArg(dir);
    expect(browserArg).toMatch(/^--browser-provenance=/);

    const { error, report } = await runWithEntries([{ status: 200 }], {
      provenance: {},
    });
    expect(error).toBeNull();
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });
});
