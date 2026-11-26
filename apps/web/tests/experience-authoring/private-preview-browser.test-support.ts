import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { expect } from 'vitest';
import type { ExperienceFrameLaunch } from '../../src/components/storefront/experience/experience-frame-types';

/** Real Baci private frame; routes only synthetic preview resources to loopback. */
export async function checkPrivatePreviewBrowser(
  launch: ExperienceFrameLaunch,
  deliver: (request: Request) => Promise<Response>
) {
  const bundled = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ExperienceFrame} from './src/components/storefront/experience/ExperienceFrame'; const active=async()=>true; createRoot(document.getElementById('root')).render(React.createElement(ExperienceFrame,{launch:window.__baciTestLaunch,isActive:active}));`,
      resolveDir: process.cwd(),
      loader: 'jsx',
    },
    tsconfig: 'tsconfig.json',
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    logLevel: 'silent',
  });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.addInitScript((value) => {
      (window as unknown as { __baciTestLaunch: unknown }).__baciTestLaunch =
        value;
    }, launch);
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET')
        return route.abort('blockedbyclient');
      if (
        url.origin === 'https://builder.synthetic.test' &&
        url.pathname === '/'
      )
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><div id="root"></div><script src="/host.js"></script>',
        });
      if (
        url.origin === 'https://builder.synthetic.test' &&
        url.pathname === '/host.js'
      )
        return route.fulfill({
          status: 200,
          contentType: 'text/javascript',
          body: bundled.outputFiles[0].text,
        });
      if (url.origin === 'https://output.synthetic-output.test') {
        const response = await deliver(new Request(url));
        return route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      }
      return route.abort('blockedbyclient');
    });
    await page.goto('https://builder.synthetic.test/', {
      waitUntil: 'domcontentloaded',
    });
    const frame = page.frameLocator(
      'iframe[title="Private full-code experience"]'
    );
    await frame
      .getByText('Synthetic New Merchant Device')
      .waitFor({ timeout: 30000 });
    await frame.getByRole('button', { name: 'Add to cart' }).click();
    await frame.getByText('Added to cart').waitFor({ timeout: 10000 });
    await frame.getByRole('button', { name: 'Review checkout' }).click();
    await frame.getByText('Checkout unavailable').waitFor({ timeout: 10000 });
    expect(
      await page.getByText('Private preview · synthetic commerce').isVisible()
    ).toBe(true);
  } finally {
    await context.close();
    await browser.close();
  }
}
