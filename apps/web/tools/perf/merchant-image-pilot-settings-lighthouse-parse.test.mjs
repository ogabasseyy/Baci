import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLighthouse } from './merchant-image-pilot-settings-lighthouse.mjs';

describe('merchant-image-pilot-settings lighthouse expectation parsing', () => {
  async function checkWith(flags) {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-settings-lhparse-'));
    const report = join(dir, 'report.json');
    await writeFile(report, JSON.stringify({ configSettings: {} }));
    const failures = [];
    const warnings = [];
    const run = () =>
      checkLighthouse(
        {
          'expect-chrome-major': '154',
          'expect-cpu-slowdown': '4',
          'expect-lh-dpr': '2',
          'expect-lh-viewport': '412x823',
          'expect-route': 'http://localhost:3000/pilot-lab/store/x',
          lighthouse: report,
          ...flags,
        },
        () => {
          warnings.push('warn');
        },
        (name, message) => {
          failures.push(`${name}: ${message}`);
        },
        {}
      );
    return { failures, run };
  }

  it('rejects non-positive DPR and CPU expectations at parse time', async () => {
    // A blank, zero, or negative flag must throw instead of certifying
    // a report under a nonsensical profile.
    for (const flag of ['expect-lh-dpr', 'expect-cpu-slowdown']) {
      for (const value of ['', '0', '-2']) {
        const { run } = await checkWith({ [flag]: value });
        await expect(run()).rejects.toThrow(`bad --${flag}`);
      }
    }
  });
});
