/** Offline replay of bytes obtained through the normal owner/RLS preview path. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { browserProcessPolicy } from '../../tools/experience-runner/browser-process-policy';
import { readBoundedUtf8 } from './bounded-input.mjs';

const input = JSON.parse(await readBoundedUtf8(process.stdin));
assert.ok([390, 1440].includes(input.width));
assert.equal(new URL(input.src).origin, 'http://127.0.0.1:4101');
const files = new Map<string, { mime: string; bytes: string }>(
  input.files.map((file: { url: string; mime: string; bytes: string }) => [
    new URL(file.url).pathname,
    file,
  ])
);
files.set(new URL(input.src).pathname, {
  mime: 'text/html',
  bytes: Buffer.from(input.html).toString('base64'),
});
const child = createServer((req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src http://127.0.0.1:4101; style-src http://127.0.0.1:4101 'unsafe-inline'; img-src http://127.0.0.1:4101; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors http://127.0.0.1:4100"
  );
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  const file = files.get(req.url ?? '');
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type', file.mime);
  res.end(Buffer.from(file.bytes, 'base64'));
});
const launch = {
  src: input.src,
  buildDigest: input.buildDigest,
  bootstrap: input.bootstrap,
  instanceId: randomUUID(),
  nonce: randomUUID(),
  routes: [{ path: '/', view: 'home' }],
  canonicalBase: 'http://127.0.0.1:4100/qa1',
};
const parent = createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  if (req.url === '/host.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(readFileSync('/opt/experience/checkpoint-b-host.js'));
    return;
  }
  if (req.url === '/launch' || req.url === '/active') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/launch' ? launch : { active: true }));
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    `<!doctype html><html><body style="margin:0">${req.url === '/no-js' ? `<iframe title="Private preview" sandbox="allow-scripts" src="${input.src}" style="width:100%;height:100svh;border:0"></iframe>` : '<div id="root"></div><script type="module" src="/host.js"></script>'}</body></html>`
  );
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await new Promise<void>((resolve, reject) => {
    parent.once('error', reject);
    parent.listen(4100, '127.0.0.1', resolve);
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.listen(4101, '127.0.0.1', resolve);
  });
  browser = await chromium.launch({
    ...browserProcessPolicy('chromium', process.env),
    headless: true,
    chromiumSandbox: true,
    timeout: 12000,
  });
  const staticContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: input.width, height: 844 },
  });
  const staticPage = await staticContext.newPage();
  staticPage.setDefaultTimeout(5000);
  await staticPage.goto('http://127.0.0.1:4100/no-js');
  assert.equal(
    await staticPage
      .frameLocator('iframe')
      .getByRole('heading', { level: 1 })
      .innerText(),
    'Full custom prerender'
  );
  const staticScreenshot = (await staticPage.screenshot()).toString('base64');
  await staticContext.close();
  const context = await browser.newContext({
    viewport: { width: input.width, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:4100/');
  const frame = page.frameLocator('iframe');
  await frame.locator('html[data-baci-hydration="ready"]').waitFor();
  const beforeClick = await frame
    .getByRole('button', { name: 'Count 0', exact: true })
    .evaluate((element) => ({
      box: element.getBoundingClientRect().toJSON(),
      inert: element.closest('[inert]') !== null,
      htmlState: document.documentElement.dataset.baciHydration,
      visibility: getComputedStyle(element).visibility,
    }));
  assert.equal(beforeClick.inert, false);
  assert.equal(beforeClick.htmlState, 'ready');
  await frame.getByRole('button', { name: 'Count 0', exact: true }).click();
  await frame.getByRole('button', { name: 'Count 1', exact: true }).waitFor();
  assert.equal(
    await frame.locator('html').getAttribute('data-baci-hydration'),
    'ready'
  );
  assert.deepEqual(errors, []);
  const screenshot = (await page.screenshot()).toString('base64');
  await context.close();
  console.log(
    JSON.stringify({
      format: 'private-prerender-browser/v1',
      width: input.width,
      noJsContent: true,
      hydration: 'ready',
      customInteraction: 'Count 1',
      clickState: beforeClick,
      errors,
      sourceDigest: input.sourceDigest,
      buildDigest: input.buildDigest,
      cwvQualified: false,
      privatePreviewCommerce:
        'existing Baci preview dispatcher; synthetic only',
      staticScreenshot,
      screenshot,
    })
  );
} finally {
  await browser?.close();
  parent.closeAllConnections();
  child.closeAllConnections();
  await Promise.all([
    new Promise<void>((resolve) => parent.close(() => resolve())),
    new Promise<void>((resolve) => child.close(() => resolve())),
  ]);
}
