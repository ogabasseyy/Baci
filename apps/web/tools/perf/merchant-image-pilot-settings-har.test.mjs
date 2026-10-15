import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  browserProvenanceArg,
  DATED_PAGE,
  pngBuffer,
  provenanceArg,
  ROUTE,
  screenshotProvenanceArg,
} from './merchant-image-pilot-settings-cli-fixtures.mjs';
import {
  assertPngDecodes,
  checkHar,
} from './merchant-image-pilot-settings-har.mjs';

describe('merchant-image-pilot-settings-har', () => {
  it('decodes valid PNGs and rejects corrupt buffers or mismatched dimensions', async () => {
    const bytes = await pngBuffer(48, 48);
    await expect(
      assertPngDecodes(bytes, { height: 48, width: 48 })
    ).resolves.toBeUndefined();
    await expect(
      assertPngDecodes(bytes, { height: 96, width: 48 })
    ).rejects.toThrow(/decoded dimensions differ/);
    await expect(
      assertPngDecodes(Buffer.from('corrupt'), { height: 48, width: 48 })
    ).rejects.toThrow(/pixels do not decode/);
  });

  it('passes checkHar on valid HAR, screenshot, and bound provenance artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-check-har-'));
    const harPath = join(dir, 'run.har');
    const shotPath = join(dir, 'shot.png');
    const shotBytes = await pngBuffer(750, 1334);
    await writeFile(shotPath, shotBytes);
    await writeFile(
      harPath,
      JSON.stringify({
        log: {
          entries: [
            {
              request: {
                headers: [
                  { name: 'User-Agent', value: 'X Chrome/154.0.0.0 Y' },
                ],
              },
              response: { status: 200 },
            },
          ],
          pages: [DATED_PAGE],
        },
      })
    );
    const cachePath = (await provenanceArg(dir)).split('=')[1];
    const shotProvPath = (await screenshotProvenanceArg(dir, shotBytes)).split(
      '='
    )[1];
    const browserPath = (await browserProvenanceArg(dir)).split('=')[1];

    const checks = [];
    const failures = [];
    const warnings = [];
    const recorded = {};
    await checkHar(
      {
        'browser-provenance': browserPath,
        'cache-provenance': cachePath,
        'expect-chrome-major': '154',
        'expect-connectivity': 'native',
        'expect-dpr': '2',
        'expect-iterations': '1',
        'expect-route': ROUTE,
        'expect-viewport': '375x667',
        har: harPath,
        screenshot: shotPath,
        'screenshot-provenance': shotProvPath,
      },
      (name) => checks.push({ name, ok: true }),
      (name, detail) => failures.push(`${name}: ${detail}`),
      (name, detail) => warnings.push(`${name}: ${detail}`),
      recorded
    );
    expect(failures).toEqual([]);
    expect(recorded.screenshot).toBe('750x1334');
    expect(recorded.browserExecutable).toBe('154.0.0.0');
  });
});
