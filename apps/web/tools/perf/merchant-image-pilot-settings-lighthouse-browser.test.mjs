import { describe, expect, it } from 'vitest';
import {
  DATED_PAGE,
  pngBuffer,
  ROUTE,
} from './merchant-image-pilot-settings-cli-fixtures.mjs';
import {
  HOST_UA,
  lhReport,
  runWithReport,
} from './merchant-image-pilot-settings-lighthouse-harness.mjs';

// Alternate-product browser identity, split out of the bounds suite
// under the repo line ceiling.
describe('merchant-image-pilot-settings lighthouse browser product', () => {
  it('refuses alternate Chromium products at the expected major', async () => {
    // Edge and Opera embed the Chrome token in their ordinary
    // documented UAs: at the expected major they must refuse as
    // non-Chrome, not pass the host-UA substring check and certify
    // another browser's metrics as the required full-Chrome run.
    const pngBytes = await pngBuffer(750, 1334);
    const harPages = [{ ...DATED_PAGE }];
    const urls = { finalDisplayedUrl: ROUTE, requestedUrl: ROUTE };
    for (const alternate of [
      `${HOST_UA} Edg/154.0.0.0`,
      `${HOST_UA} OPR/110.0.0.0`,
    ]) {
      const run = await runWithReport({
        harPages,
        pngBytes,
        report: lhReport(urls, alternate),
      });
      expect(run.error).not.toBe(null);
      expect(run.stdout).toMatch(/lighthouse\.browser/);
      expect(run.stdout).toMatch(/not full Chrome/);
    }
  });
});
