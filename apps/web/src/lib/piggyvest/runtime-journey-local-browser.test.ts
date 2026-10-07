// @vitest-environment node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { it, vi } from 'vitest';
import { startRuntimeJourneyLocal } from './runtime-journey-local';
import { resolveRuntimeJourneyBrowserConfiguration } from './runtime-journey-local-browser-config';
import { applyRuntimeJourneyFixture } from './runtime-journey-local-fixture';

vi.mock('server-only', () => ({}));

it.skipIf(process.env.PIGGYVEST_RUN_RUNTIME_JOURNEY_BROWSER !== '1')(
  'composes the actual browser assets with fresh restricted PG and HTTP',
  async () => {
    const configuration = resolveRuntimeJourneyBrowserConfiguration(
      Number(process.env.PIGGYVEST_RUNTIME_JOURNEY_BROWSER_PORT)
    );
    const start = (sequence: 701 | 702 | 703) =>
      startRuntimeJourneyLocal({
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        sequence,
        browserOrigin: configuration.origin,
        csrfCookiePath: `/scenario/${sequence}`,
      });
    const credit = (sequence: 701 | 702 | 703) =>
      applyRuntimeJourneyFixture({
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        sequence,
        action: 'credit',
      });
    const modulePath = pathToFileURL(
      resolve(
        process.cwd(),
        '../../tools/test/runtime-journey-browser/journey.mjs'
      )
    ).href;
    const browser: {
      runRuntimeJourneyBrowser: (options: {
        start: typeof start;
        credit: typeof credit;
        port: 4181 | 4183;
      }) => Promise<{
        origin: string;
        close: () => Promise<void>;
        verify: () => Promise<void>;
      }>;
    } = await import(modulePath);
    const journey = await browser.runRuntimeJourneyBrowser({
      start,
      credit,
      port: configuration.port,
    });
    try {
      await journey.verify();
      if (process.env.PIGGYVEST_HOLD_RUNTIME_JOURNEY_BROWSER === '1') {
        process.stdout.write(
          `SYNTHETIC ONLY browser ready: ${journey.origin}\n`
        );
        await new Promise<void>((done) => {
          const stop = () => {
            process.off('SIGINT', stop);
            process.off('SIGTERM', stop);
            done();
          };
          process.once('SIGINT', stop);
          process.once('SIGTERM', stop);
        });
      }
    } finally {
      await journey.close();
    }
  },
  0
);
