/** Offline browser proof of exact bytes read from the normal anonymous/RLS gateway. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { browserProcessPolicy } from '../../tools/experience-runner/browser-process-policy';
import { readBoundedUtf8 } from '../experience-performance/bounded-input.mjs';

interface BrowserInput {
  width: number;
  hostOrigin: string;
  launch: import('../../src/components/storefront/experience/experience-frame-types').ExperienceFrameLaunch;
  html: string;
  files: Array<{ url: string; mime: string; bytes: string }>;
  sourceDigest: string;
}
const input = JSON.parse(await readBoundedUtf8(process.stdin)) as BrowserInput;
assert.ok([390, 1440].includes(input.width));
const parentOrigin = new URL(input.hostOrigin);
const frameOrigin = new URL(input.launch.src);
assert.equal(parentOrigin.hostname, '127.0.0.1');
assert.equal(frameOrigin.hostname, '127.0.0.1');
assert.equal(parentOrigin.protocol, 'http:');
assert.equal(frameOrigin.protocol, 'http:');
const files = new Map<string, { mime: string; bytes: string }>(
  input.files.map((file: { url: string; mime: string; bytes: string }) => [
    new URL(file.url).pathname,
    file,
  ])
);
files.set(frameOrigin.pathname + frameOrigin.search, {
  mime: 'text/html',
  bytes: Buffer.from(input.html).toString('base64'),
});
const child = createServer((req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self';connect-src 'none';base-uri 'none';form-action 'none';frame-ancestors ${parentOrigin.origin}`
  );
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
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
    res.end(
      JSON.stringify(req.url === '/launch' ? input.launch : { active: true })
    );
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    `<!doctype html><html><body style="margin:0">${req.url === '/no-js' ? `<iframe title="Orbit" sandbox="allow-scripts" src="${input.launch.src}" style="border:0;width:100%;height:100svh"></iframe>` : '<div id="root"></div><script type="module" src="/host.js"></script>'}</body></html>`
  );
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await new Promise<void>((resolve, reject) => {
    parent.once('error', reject);
    parent.listen(Number(parentOrigin.port), '127.0.0.1', resolve);
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.listen(Number(frameOrigin.port), '127.0.0.1', resolve);
  });
  browser = await chromium.launch({
    ...browserProcessPolicy('chromium', process.env),
    headless: true,
    chromiumSandbox: true,
    timeout: 12000,
  });
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: input.width, height: 844 },
  });
  const staticPage = await noJs.newPage();
  staticPage.setDefaultTimeout(5000);
  await staticPage.goto(`${parentOrigin.origin}/no-js`);
  const staticFrame = staticPage.frameLocator('iframe');
  assert.match(
    await staticFrame.getByRole('heading', { level: 1 }).innerText(),
    /orbit/i
  );
  const images = await staticFrame
    .locator('img')
    .evaluateAll(async (elements) => {
      await Promise.all(
        elements.map((el) => (el as HTMLImageElement).decode())
      );
      return elements.map((el) => ({
        width: (el as HTMLImageElement).naturalWidth,
        complete: (el as HTMLImageElement).complete,
      }));
    });
  assert.ok(
    images.length > 0 &&
      images.every((image) => image.complete && image.width > 0)
  );
  const staticScreenshot = (await staticPage.screenshot()).toString('base64');
  await noJs.close();
  const context = await browser.newContext({
    viewport: { width: input.width, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(parentOrigin.origin);
  const frame = page.frameLocator('iframe');
  await frame.locator('html[data-baci-hydration="ready"]').waitFor();
  await frame.getByRole('button', { name: 'Preview Ink', exact: true }).click();
  assert.equal(
    await frame
      .getByRole('button', { name: 'Preview Ink', exact: true })
      .getAttribute('aria-pressed'),
    'true'
  );
  assert.deepEqual(errors, []);
  const screenshot = (await page.screenshot()).toString('base64');
  await context.close();
  console.log(
    JSON.stringify({
      format: 'durable-public-browser/v1',
      width: input.width,
      buildDigest: input.launch.buildDigest,
      sourceDigest: input.sourceDigest,
      noJsContent: true,
      images,
      hydration: 'ready',
      customInteraction: 'Ink',
      errors,
      cwvQualified: false,
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
