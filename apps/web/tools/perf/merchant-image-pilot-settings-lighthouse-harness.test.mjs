import { describe, expect, it } from 'vitest';
import {
  DATED_PAGE,
  pngBuffer,
  ROUTE,
} from './merchant-image-pilot-settings-cli-fixtures.mjs';
import {
  HOST_UA,
  LH_FLAGS,
  lhReport,
  runWithReport,
} from './merchant-image-pilot-settings-lighthouse-harness.mjs';

describe('merchant-image-pilot-settings-lighthouse-harness', () => {
  it('builds Lighthouse reports and runs the settings gate subprocess', async () => {
    expect(LH_FLAGS).toContain('--expect-form-factor=mobile');
    expect(HOST_UA).toContain('Chrome/154.0.0.0');

    const report = lhReport({
      finalDisplayedUrl: ROUTE,
      requestedUrl: ROUTE,
    });
    expect(report.environment.hostUserAgent).toBe(HOST_UA);
    expect(report.configSettings.formFactor).toBe('mobile');

    const pngBytes = await pngBuffer(750, 1334);
    const { error, stdout } = await runWithReport({
      harPages: [DATED_PAGE],
      pngBytes,
      report,
    });
    expect(error).toBeNull();
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.failures).toEqual([]);
  });
});
