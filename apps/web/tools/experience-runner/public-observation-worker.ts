import { chromium } from 'playwright-core';
import { createPublicCartWorkerClient } from './public-cart-worker-client';
import { observePublicBrowser } from './public-observation-browser';
import { readPublicObservationStart } from './public-observation-start';

/** Fixed worker entrypoint. Only install under the qualified network-disabled helper. */
async function main() {
  const payload = await readPublicObservationStart(process.stdin);
  const client = createPublicCartWorkerClient({
    input: process.stdin,
    output: process.stdout,
  });
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    timeout: 20000,
  });
  try {
    const observation = await observePublicBrowser(
      payload,
      browser,
      client.request
    );
    await browser.close();
    await client.finish(observation);
  } catch (error) {
    await browser.close();
    throw error;
  }
}

main().catch(() => {
  process.stderr.write('PUBLIC_OBSERVATION_WORKER_FAILED\n');
  process.stdin.destroy();
  process.exitCode = 1;
});
