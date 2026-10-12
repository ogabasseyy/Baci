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

describe('merchant-image-pilot-settings viewport and DPR evidence', () => {
  it('rejects a same-product viewport/DPR pair from provenance', async () => {
    // PNG pixels only prove viewport×DPR: a 750x1334 screenshot satisfies
    // both 375x667@2 and 750x1334@1, so the product check passes while the
    // run profile is wrong. The runner-recorded pair breaks the tie —
    // each compared independently, exactly.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-pair-'));
    const harPath = join(dir, 'browsertime.har');
    const pngPath = join(dir, 'shot.png');
    const provenance = await provenanceArg(dir);
    const browser = await browserProvenanceArg(dir);
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
          pages: [{ ...DATED_PAGE }],
        },
      })
    );
    const pngBytes = await pngBuffer(750, 1334);
    await writeFile(pngPath, pngBytes);
    const shotWrongPair = await screenshotProvenanceArg(dir, pngBytes, {
      deviceScaleFactor: 1,
      viewport: { height: 1334, width: 750 },
    });
    const { execFile } = await import('node:child_process');
    const { error, stdout } = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [
          join(
            // @ts-expect-error import.meta.dirname is provided by vitest.
            import.meta.dirname,
            'merchant-image-pilot-settings.mjs'
          ),
          `--har=${harPath}`,
          `--screenshot=${pngPath}`,
          '--expect-iterations=1',
          '--expect-connectivity=native',
          `--expect-route=${ROUTE}`,
          '--expect-chrome-major=154',
          '--expect-viewport=375x667',
          '--expect-dpr=2',
          provenance,
          shotWrongPair,
          browser,
        ],
        (execError, execStdout) =>
          resolve({ error: execError, stdout: execStdout })
      );
    });
    expect(error).not.toBe(null);
    expect(stdout).toMatch(
      /provenance viewport 750x1334 is not expected 375x667/
    );
    expect(stdout).toMatch(/provenance deviceScaleFactor 1 is not expected 2/);
  });

  it('rejects a non-numeric expected DPR at the CLI instead of passing geometry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-dpr-'));
    const harPath = join(dir, 'browsertime.har');
    const pngPath = join(dir, 'shot.png');
    await writeFile(
      harPath,
      JSON.stringify({
        log: {
          entries: [],
          pages: [
            {
              _meta: { connectivity: 'native' },
              _url: ROUTE,
              title: 'u run 1',
            },
          ],
        },
      })
    );
    await writeFile(pngPath, await pngBuffer(750, 1334));
    const { execFile } = await import('node:child_process');
    const { error, stdout } = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [
          join(
            // @ts-expect-error import.meta.dirname is provided by vitest.
            import.meta.dirname,
            'merchant-image-pilot-settings.mjs'
          ),
          `--har=${harPath}`,
          `--screenshot=${pngPath}`,
          '--expect-iterations=1',
          '--expect-connectivity=native',
          `--expect-route=${ROUTE}`,
          '--expect-chrome-major=154',
          '--expect-viewport=375x667',
          '--expect-dpr=abc',
          '--cache-provenance=test-fresh-profile',
        ],
        (execError, execStdout) =>
          resolve({ error: execError, stdout: execStdout })
      );
    });
    expect(error).not.toBe(null);
    expect(stdout).toMatch(/bad --expect-dpr/);
    expect(JSON.parse(stdout).ok).toBe(false);
  });
});
