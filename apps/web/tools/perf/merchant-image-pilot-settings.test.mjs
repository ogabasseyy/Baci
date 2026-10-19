import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runWithEntries } from './merchant-image-pilot-settings-cli-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, 'merchant-image-pilot-settings.mjs');

describe('merchant-image-pilot-settings CLI', () => {
  it('exits non-zero with usage failure when required flags are missing', async () => {
    const result = await new Promise((resolve) => {
      execFile(process.execPath, [SCRIPT, '--har=only.har'], (error, stdout) =>
        resolve({ error, report: JSON.parse(stdout) })
      );
    });
    expect(result.error).not.toBeNull();
    expect(result.report.ok).toBe(false);
    expect(result.report.failures[0]).toMatch(/usage: missing --screenshot/);
  });

  it('requires network throttling flags when --lighthouse is supplied', async () => {
    const { error, report } = await runWithEntries([{ status: 200 }], {
      extra: [
        '--lighthouse=report.json',
        '--expect-form-factor=mobile',
        '--expect-throttling-method=simulate',
        '--expect-lh-viewport=412x823',
        '--expect-lh-dpr=1.75',
        '--expect-cpu-slowdown=4',
      ],
      provenance: {},
    });
    expect(error).not.toBeNull();
    expect(report.ok).toBe(false);
    expect(report.failures).toContain(
      'usage: missing --expect-rtt-ms, --expect-throughput-kbps'
    );
  });
});
