import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE } from './merchant-image-pilot-settings-cli-fixtures.mjs';
import { checkLighthouse } from './merchant-image-pilot-settings-lighthouse.mjs';
import { lhReport } from './merchant-image-pilot-settings-lighthouse-harness.mjs';

describe('merchant-image-pilot-settings-lighthouse', () => {
  it('passes on a matching simulate Lighthouse report and records settings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-check-lh-'));
    const lhPath = join(dir, 'report.json');
    await writeFile(
      lhPath,
      JSON.stringify(
        lhReport({ finalDisplayedUrl: ROUTE, requestedUrl: ROUTE })
      )
    );
    const checks = [];
    const failures = [];
    const recorded = {};
    await checkLighthouse(
      {
        'expect-chrome-major': '154',
        'expect-cpu-slowdown': '4',
        'expect-form-factor': 'mobile',
        'expect-lh-dpr': '1.75',
        'expect-lh-viewport': '412x823',
        'expect-route': ROUTE,
        'expect-rtt-ms': '150',
        'expect-throttling-method': 'simulate',
        'expect-throughput-kbps': '1638.4',
        lighthouse: lhPath,
      },
      (name) => checks.push({ name, ok: true }),
      (name, detail) => failures.push(`${name}: ${detail}`),
      recorded
    );
    expect(failures).toEqual([]);
    expect(recorded.lighthouse.screenEmulation).toEqual({
      disabled: false,
      mobile: true,
    });
  });

  it('fails closed on headless-shell UA or disabled screenEmulation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-check-lh-bad-'));
    const lhPath = join(dir, 'bad.json');
    const report = lhReport(
      { finalDisplayedUrl: ROUTE, requestedUrl: ROUTE },
      'Mozilla/5.0 HeadlessChrome/154.0.0.0'
    );
    report.configSettings.screenEmulation.disabled = true;
    await writeFile(lhPath, JSON.stringify(report));

    const failures = [];
    await checkLighthouse(
      {
        'expect-chrome-major': '154',
        'expect-cpu-slowdown': '4',
        'expect-form-factor': 'mobile',
        'expect-lh-dpr': '1.75',
        'expect-lh-viewport': '412x823',
        'expect-route': ROUTE,
        'expect-rtt-ms': '150',
        'expect-throttling-method': 'simulate',
        'expect-throughput-kbps': '1638.4',
        lighthouse: lhPath,
      },
      () => undefined,
      (name, detail) => failures.push(`${name}: ${detail}`),
      {}
    );
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /lighthouse\.browser: host browser is chrome-headless-shell/
        ),
        expect.stringMatching(
          /lighthouse\.screen-emulation: screen emulation not applied/
        ),
      ])
    );
  });
});
