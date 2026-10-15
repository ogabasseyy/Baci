import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  browserProvenanceArg,
  provenanceArg,
  ROUTE,
  screenshotProvenanceArg,
} from './merchant-image-pilot-settings-cli-fixtures.mjs';

// Shared Lighthouse settings-gate harness, split out of the bounds
// suite under the repo line ceiling: report builder plus the
// subprocess runner the browser-identity suites execute through.
export const LH_FLAGS = [
  '--expect-form-factor=mobile',
  '--expect-throttling-method=simulate',
  '--expect-rtt-ms=150',
  '--expect-throughput-kbps=1638.4',
  '--expect-lh-viewport=412x823',
  '--expect-lh-dpr=1.75',
  '--expect-cpu-slowdown=4',
];

// Real-host browser UA (not the emulated request UA): Lighthouse
// records the executable it drove in environment.hostUserAgent.
export const HOST_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

export function lhReport(urls, hostUserAgent = HOST_UA) {
  return {
    configSettings: {
      formFactor: 'mobile',
      screenEmulation: {
        deviceScaleFactor: 1.75,
        disabled: false,
        height: 823,
        mobile: true,
        width: 412,
      },
      throttling: {
        cpuSlowdownMultiplier: 4,
        rttMs: 150,
        throughputKbps: 1638.4,
      },
      throttlingMethod: 'simulate',
    },
    environment: { hostUserAgent },
    ...urls,
  };
}

const here = dirname(fileURLToPath(import.meta.url));

export async function runWithReport({ harPages, pngBytes, report, shotBytes }) {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-lhroute-'));
  const harPath = join(dir, 'run.har');
  const pngPath = join(dir, 'shot.png');
  const lhPath = join(dir, 'report.json');
  const shot = shotBytes ?? pngBytes;
  await writeFile(
    harPath,
    JSON.stringify({
      log: {
        entries: [
          {
            request: {
              headers: [{ name: 'User-Agent', value: 'X Chrome/154.0.0.0 Y' }],
            },
            response: { status: 200 },
          },
        ],
        pages: harPages,
      },
    })
  );
  await writeFile(pngPath, pngBytes);
  await writeFile(lhPath, JSON.stringify(report));
  const provenance = await provenanceArg(dir);
  const shotArg = await screenshotProvenanceArg(dir, shot, {
    deviceScaleFactor: 2,
    viewport: { height: 667, width: 375 },
  });
  const browser = await browserProvenanceArg(dir);
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        join(here, 'merchant-image-pilot-settings.mjs'),
        `--har=${harPath}`,
        `--screenshot=${pngPath}`,
        `--lighthouse=${lhPath}`,
        '--expect-iterations=1',
        '--expect-connectivity=native',
        `--expect-route=${ROUTE}`,
        '--expect-chrome-major=154',
        '--expect-viewport=375x667',
        '--expect-dpr=2',
        provenance,
        shotArg,
        browser,
        ...LH_FLAGS,
      ],
      (error, stdout) => resolve({ error, stdout })
    );
  });
}
