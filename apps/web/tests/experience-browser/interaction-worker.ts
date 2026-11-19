import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { type Browser, chromium, firefox, webkit } from 'playwright-core';
import { browserProcessPolicy } from '../../tools/experience-runner/browser-process-policy';
import { runCheckpointB } from './checkpoint-b-worker';
import {
  type QualificationInput,
  startQualificationServers,
} from './harness-server';

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw Error('Input budget');
  }
  const input = JSON.parse(raw) as QualificationInput & { fixture: string };
  if (input.mode === 'checkpoint-b') {
    console.log(
      JSON.stringify(
        await runCheckpointB(
          input as unknown as Parameters<typeof runCheckpointB>[0]
        )
      )
    );
    return;
  }
  let browser: Browser | undefined;
  const servers: Server[] = [];
  const errors: string[] = [];
  try {
    const running = await startQualificationServers(input, new Map());
    servers.push(...running.servers);
    browser = await { chromium, firefox, webkit }[input.engine].launch({
      ...browserProcessPolicy(input.engine, process.env),
      headless: true,
      timeout: 12000,
      ...(input.engine === 'chromium' ? { chromiumSandbox: true } : {}),
    });
    const page = await browser.newPage({
      viewport: { width: input.width, height: 844 },
    });
    page.setDefaultTimeout(5000);
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto('http://127.0.0.1:4100/');
    const frame = page.frameLocator('iframe');
    await frame.getByRole('heading', { level: 1 }).waitFor();
    const child = page
      .frames()
      .find((f) => f.url().startsWith('http://127.0.0.1:4101/'));
    assert.ok(child);
    await child.evaluate(async () => {
      await document.fonts.ready;
    });
    assert.equal(await child.evaluate(() => self.origin), 'null');
    if (input.fixture === 'editorial-fashion') {
      await frame.getByRole('button', { name: 'Explore details' }).click();
      await frame
        .getByRole('heading', { name: 'Synthetic QA Device' })
        .waitFor();
    }
    const art = frame.getByRole('img', {
      name:
        input.fixture === 'device-configurator'
          ? 'Synthetic device illustration'
          : 'Draggable animated tile',
    });
    if (input.fixture === 'device-configurator') {
      assert.equal(
        await frame.locator('main').getAttribute('data-ready'),
        'true'
      );
      assert.equal(await art.getAttribute('data-ref-ready'), 'true');
      await frame.getByRole('combobox').selectOption('ink');
      await frame.getByText('Selected finish: ink').waitFor();
      await frame.getByRole('button', { name: 'Zoom illustration' }).click();
      assert.equal(
        await frame
          .getByRole('button', { name: 'Zoom illustration' })
          .getAttribute('aria-pressed'),
        'true'
      );
    }
    if (input.fixture === 'motion-studio') {
      await frame.getByRole('button', { name: 'Animate tile' }).click();
      await art.evaluate(
        (el) =>
          new Promise<void>((resolve, reject) => {
            const start = performance.now();
            function check() {
              if (getComputedStyle(el).transform !== 'none') resolve();
              else if (performance.now() - start > 2000)
                reject(Error('No animation'));
              else requestAnimationFrame(check);
            }
            check();
          })
      );
    }
    if (input.fixture !== 'editorial-fashion') {
      const before = await art.getAttribute('style');
      const box = await art.boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + 25,
        box.y + box.height / 2 + 10,
        { steps: 8 }
      );
      await page.mouse.up();
      assert.notEqual(
        await art.getAttribute('style'),
        before,
        'Drag did not change authored state'
      );
    }
    await frame.getByRole('button', { name: 'Add synthetic item' }).click();
    await frame
      .getByRole('status')
      .filter({ hasText: 'Mock bag: 1' })
      .waitFor();
    for (let i = 0; i < 4; i++) {
      await frame.getByRole('navigation').getByRole('button').nth(i).click();
      await frame
        .locator('main > p')
        .filter({
          hasText: new RegExp(
            `\\b${['home', 'collection', 'product', 'editorial'][i]}\\b`
          ),
        })
        .first()
        .waitFor();
      await frame
        .getByRole('status')
        .filter({ hasText: 'Mock bag: 1' })
        .waitFor();
    }
    assert.equal(
      await child.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true,
      'Horizontal overflow'
    );
    assert.deepEqual(errors, []);
    const screenshot = await page.screenshot({ type: 'png' });
    console.log(
      JSON.stringify({
        status: 'passed',
        engine: input.engine,
        width: input.width,
        fixture: input.fixture,
        screenshot: screenshot.toString('base64'),
        opaqueOrigin: true,
        routes: 4,
        mockBag: 1,
      })
    );
  } finally {
    await browser?.close();
    for (const server of servers) server.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
