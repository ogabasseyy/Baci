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

describe('merchant-image-pilot-settings route and artifact bounds', () => {
  const UA_ENTRY = {
    request: {
      headers: [{ name: 'User-Agent', value: 'X Chrome/154.0.0.0 Y' }],
    },
    response: { status: 200 },
  };

  function harWithPages(pages) {
    return { log: { entries: [structuredClone(UA_ENTRY)], pages } };
  }

  async function runGate(harJson, extra = [], route = ROUTE) {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-route-'));
    const harPath = join(dir, 'run.har');
    const pngPath = join(dir, 'shot.png');
    const pngBytes = await pngBuffer(750, 1334);
    await writeFile(harPath, JSON.stringify(harJson));
    await writeFile(pngPath, pngBytes);
    const shot = await screenshotProvenanceArg(dir, pngBytes, {
      deviceScaleFactor: 2,
      viewport: { height: 667, width: 375 },
    });
    const provenance = await provenanceArg(dir);
    const browser = await browserProvenanceArg(dir);
    const { execFile } = await import('node:child_process');
    return new Promise((resolve) => {
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
          `--expect-route=${route}`,
          '--expect-chrome-major=154',
          '--expect-viewport=375x667',
          '--expect-dpr=2',
          provenance,
          shot,
          browser,
          ...extra,
        ],
        (error, stdout) => resolve({ error, stdout })
      );
    });
  }

  it('fails a navigation to the wrong store, arm, or redirect target', async () => {
    const har = harWithPages([{ ...DATED_PAGE }]);
    const matched = await runGate(har);
    expect(JSON.parse(matched.stdout).ok).toBe(true);
    const wrongArm = structuredClone(har);
    wrongArm.log.pages[0]._url =
      'http://localhost:3000/pilot-lab/store/ogabassey?arm=control';
    const arm = await runGate(wrongArm);
    expect(arm.error).not.toBe(null);
    expect(arm.stdout).toMatch(/HAR page navigated .* expected /);
    const wrongStore = structuredClone(har);
    wrongStore.log.pages[0]._url =
      'http://localhost:3000/pilot-lab/store/other?arm=pilot';
    const store = await runGate(wrongStore);
    expect(store.error).not.toBe(null);
    expect(store.stdout).toMatch(/HAR page navigated .* expected /);
  });

  it('fails pages with no navigation URL or an unparseable expectation', async () => {
    const har = harWithPages([{ ...DATED_PAGE }]);
    delete har.log.pages[0]._url;
    const missing = await runGate(har);
    expect(missing.error).not.toBe(null);
    expect(missing.stdout).toMatch(/not a valid URL/);
    const noUrl = harWithPages([{ ...DATED_PAGE }]);
    delete noUrl.log.pages[0]._url;
    delete noUrl.log.pages[0].title;
    const absent = await runGate(noUrl);
    expect(absent.error).not.toBe(null);
    expect(absent.stdout).toMatch(/no navigation URL/);
    const badArg = await runGate(
      harWithPages([{ ...DATED_PAGE }]),
      [],
      '::not-a-url::'
    );
    expect(badArg.error).not.toBe(null);
    expect(badArg.stdout).toMatch(/bad --expect-route/);
  });

  it('fails oversized artifacts by size instead of exhausting the reader', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-bounds-'));
    const harPath = join(dir, 'huge.har');
    const pngPath = join(dir, 'shot.png');
    await writeFile(pngPath, await pngBuffer(750, 1334));
    // Sparse 257 MiB file: instant to create, over the 256 MiB HAR
    // budget, and the bounded reader stops after the ceiling.
    const { open } = await import('node:fs/promises');
    const handle = await open(harPath, 'w');
    try {
      await handle.truncate(257 * 1024 * 1024);
    } finally {
      await handle.close();
    }
    const { execFile } = await import('node:child_process');
    const gatePath = join(
      // @ts-expect-error import.meta.dirname is provided by vitest.
      import.meta.dirname,
      'merchant-image-pilot-settings.mjs'
    );
    const base = [
      `--screenshot=${pngPath}`,
      '--expect-iterations=1',
      '--expect-connectivity=native',
      `--expect-route=${ROUTE}`,
      '--expect-chrome-major=154',
      '--expect-viewport=375x667',
      '--expect-dpr=2',
      '--cache-provenance=test-fresh-profile',
    ];
    const huge = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [gatePath, `--har=${harPath}`, ...base],
        (error, stdout) => resolve({ error, stdout })
      );
    });
    expect(huge.error).not.toBe(null);
    expect(huge.stdout).toMatch(/exceeds the HAR byte budget/);
    // An oversized provenance record fails by the same operator-JSON
    // budget instead of buffering an unbounded file.
    const har = harWithPages([{ ...DATED_PAGE }]);
    const smallHar = join(dir, 'run.har');
    await writeFile(smallHar, JSON.stringify(har));
    const bigProvenance = join(dir, 'big-cache.json');
    await writeFile(bigProvenance, `{"pad":"${'x'.repeat(1024 * 1024)}"}`);
    const big = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [
          gatePath,
          `--har=${smallHar}`,
          ...base.filter((arg) => !arg.startsWith('--cache-provenance=')),
          `--cache-provenance=${bigProvenance}`,
        ],
        (error, stdout) => resolve({ error, stdout })
      );
    });
    expect(big.error).not.toBe(null);
    expect(big.stdout).toMatch(/exceeds the operator-JSON budget/);
  });
});
