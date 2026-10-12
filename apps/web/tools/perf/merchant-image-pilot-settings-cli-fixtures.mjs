import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

// Real encodings: the gate fully validates PNG structure, so header-only
// fakes no longer pass har.geometry.
export function pngBuffer(width, height) {
  return sharp({
    create: { background: '#ffffff', channels: 3, height, width },
  })
    .png()
    .toBuffer();
}

export async function provenanceArg(dir, overrides = {}) {
  const path = join(dir, `reset-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(
    path,
    JSON.stringify({
      event: 'profile-reset',
      freshProfile: true,
      profileDir: join(dir, 'profile'),
      resetAt: '2026-10-04T00:09:00.000Z',
      runId: 'run-navigation-1',
      tool: 'browsertime',
      ...overrides,
    })
  );
  return `--cache-provenance=${path}`;
}

export const ROUTE =
  'http://localhost:3000/pilot-lab/store/ogabassey?arm=pilot';

export const DATED_PAGE = {
  _meta: { connectivity: 'native', runId: 'run-navigation-1' },
  _url: ROUTE,
  startedDateTime: '2026-10-04T00:10:00.000Z',
  title: 'u run 1',
};

export async function screenshotProvenanceArg(dir, pngBytes, overrides = {}) {
  const path = join(dir, `shot-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(
    path,
    JSON.stringify({
      capturedAt: '2026-10-04T00:10:30.000Z',
      deviceScaleFactor: 2,
      event: 'screenshot-capture',
      runId: 'run-navigation-1',
      screenshotSha256: createHash('sha256').update(pngBytes).digest('hex'),
      tool: 'browsertime',
      viewport: { height: 667, width: 375 },
      ...overrides,
    })
  );
  return `--screenshot-provenance=${path}`;
}

export async function runWithEntries(
  entries,
  { extra = [], pages, provenance, provenanceRaw, shot = {}, shotRaw } = {}
) {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-cache-'));
  const harPath = join(dir, 'browsertime.har');
  const pngPath = join(dir, 'shot.png');
  await writeFile(
    harPath,
    JSON.stringify({
      log: {
        entries: entries.map((item) => {
          // Plain response object, or { cache, response } for retained
          // disk-cache markers.
          const shaped =
            item && typeof item === 'object' && 'response' in item
              ? item
              : { response: item };
          return {
            ...(shaped.cache === undefined ? {} : { cache: shaped.cache }),
            request: {
              headers: [
                {
                  name: 'User-Agent',
                  value: 'X Chrome/154.0.0.0 Y',
                },
              ],
            },
            response: shaped.response,
          };
        }),
        pages: pages ?? [{ ...DATED_PAGE }],
      },
    })
  );
  const shotBytes = await pngBuffer(750, 1334);
  await writeFile(pngPath, shotBytes);
  // Provenance is a runner artifact file: {} writes a valid one bound
  // to the dated pages, a string passes through literally (bogus
  // paths), and provenanceRaw writes non-JSON bytes. Screenshots bind
  // by default (the geometry gate requires it); shot:false omits the
  // binding for the missing-provenance case.
  const provenanceArgs = [];
  if (typeof provenance === 'string') {
    provenanceArgs.push(`--cache-provenance=${provenance}`);
  } else if (provenance !== undefined) {
    provenanceArgs.push(await provenanceArg(dir, provenance));
  }
  if (provenanceRaw !== undefined) {
    const rawPath = join(dir, 'reset-raw.json');
    await writeFile(rawPath, provenanceRaw);
    provenanceArgs.push(`--cache-provenance=${rawPath}`);
  }
  if (typeof shot === 'string') {
    provenanceArgs.push(`--screenshot-provenance=${shot}`);
  } else if (shot !== false) {
    provenanceArgs.push(
      await screenshotProvenanceArg(dir, shotBytes, shot ?? {})
    );
  }
  if (shotRaw !== undefined) {
    const rawPath = join(dir, 'shot-raw.json');
    await writeFile(rawPath, shotRaw);
    provenanceArgs.push(`--screenshot-provenance=${rawPath}`);
  }
  const { execFile } = await import('node:child_process');
  const report = await new Promise((resolve) => {
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
        ...extra,
        ...provenanceArgs,
      ],
      (error, stdout) => resolve({ error, report: JSON.parse(stdout) })
    );
  });
  return report;
}
