import { chromium } from 'playwright-core';
import { verifyCompiledCandidate } from '../../src/lib/experience/compiled-candidate';
import { performanceWorkerInput } from '../../src/schemas/experience-performance-worker';
import { readBoundedUtf8 } from '../../tests/experience-performance/bounded-input.mjs';
import { installIsolatedPerformanceCollector } from './isolated-performance-collector';
import { startPerformanceHarness } from './performance-harness';

const input = performanceWorkerInput.parse(
  JSON.parse(await readBoundedUtf8(process.stdin))
);
verifyCompiledCandidate(input.bundle);
const harness = await startPerformanceHarness(input);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({
    headless: true,
    ...harness.chromiumOptions,
  });
  const context = await browser.newContext({
    viewport: { width: input.width, height: input.width === 390 ? 844 : 900 },
    deviceScaleFactor: 1,
    isMobile: input.width === 390,
    hasTouch: input.width === 390,
    locale: 'en-NG',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const collector = await installIsolatedPerformanceCollector(page);
  let consoleErrors = 0;
  const failed = () => {
    consoleErrors = Math.min(1000, consoleErrors + 1);
  };
  page.on('pageerror', failed);
  page.on('console', (message) => {
    if (message.type() === 'error') failed();
  });
  page.on('requestfailed', failed);
  await page.goto(harness.origin, { waitUntil: 'load', timeout: 12000 });
  await page.waitForTimeout(2000);
  const metrics = await collector.read();
  const sameWidth =
    metrics.host.viewport.width === input.width &&
    metrics.frame.viewport.width === input.width;
  console.log(
    JSON.stringify({
      format: 'baci.performance-sample/v1',
      policyId: 'chromium-native-reference/v1',
      browser: `Chromium ${browser.version()}`,
      route: input.bootstrap.route.canonicalPath,
      width: input.width,
      buildDigest: input.bundle.digest,
      cache: 'cold-context',
      hostLcpMs: metrics.host.lcpMs,
      frameLcpMs: metrics.frame.lcpMs,
      hostCls: metrics.host.cls,
      frameCls: metrics.frame.cls,
      diagnostics: {
        transport: harness.transport,
        tlsConnections: harness.tlsConnections(),
        host: {
          rawCls: metrics.host.rawCls,
          firstPaintMs: metrics.host.firstPaintMs,
          rawLayoutShifts: metrics.host.rawLayoutShifts,
          layoutShiftOverflow: metrics.host.layoutShiftOverflow,
        },
        frame: {
          rawCls: metrics.frame.rawCls,
          firstPaintMs: metrics.frame.firstPaintMs,
          rawLayoutShifts: metrics.frame.rawLayoutShifts,
          layoutShiftOverflow: metrics.frame.layoutShiftOverflow,
        },
      },
      interactionDurationMs: null,
      contentVisible: metrics.contentVisible,
      imagesDecoded: metrics.imagesDecoded,
      consoleErrors: Math.min(1000, consoleErrors + harness.blockedRequests()),
      contaminated: metrics.contaminated || !sameWidth,
      observationWindowMs: 2000,
    })
  );
  await collector.close();
  await context.close();
} finally {
  await browser?.close();
  await harness.close();
}
