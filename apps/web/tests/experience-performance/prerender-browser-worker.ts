/** Independent functional browser proof, never CWV or publication authority. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { browserProcessPolicy } from '../../tools/experience-runner/browser-process-policy';

import { readBoundedUtf8 } from './bounded-input.mjs';
import { installLabObservers, readLabMetrics } from './lab-observers';

const raw = await readBoundedUtf8(process.stdin);
const input = JSON.parse(raw) as {
  html: string;
  javascript: string;
  css: string;
  baseline: string;
  bootstrap: unknown;
  image: string;
  width: number;
  benchmark?: 'client' | 'prerender';
};
assert.ok([390, 1440].includes(input.width));
const host = 'http://127.0.0.1:43176';
const childOrigin = 'http://127.0.0.1:43177';
const hostJs = `const f=document.querySelector('iframe');f.addEventListener('load',()=>{const c=new MessageChannel();c.port1.onmessage=e=>{if(e.data?.type==='ready'&&e.data.nonce==='local-proof'){c.port1.postMessage({type:'bootstrap',bootstrap:${JSON.stringify(input.bootstrap)}});return;}if(e.data?.requestId)c.port1.postMessage({type:'result',requestId:e.data.requestId,result:{status:'error',code:'INSUFFICIENT_SCOPE',message:'Read-only proof'}});};c.port1.start();f.contentWindow.postMessage({type:'baci-experience-connect',nonce:'local-proof',instanceId:'local-proof',buildDigest:'synthetic'},'*',[c.port2]);});`;
const parent = createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  if (req.url === '/parent.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(hostJs);
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    `<!doctype html><html><body style="margin:0"><iframe title="Orbit" sandbox="allow-scripts" style="border:0;width:100%;height:100svh" src="${childOrigin}/${req.url === '/baseline' ? 'baseline.html' : 'index.html'}"></iframe><script src="/parent.js" defer></script></body></html>`
  );
});
const child = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self';connect-src 'none';form-action 'none';base-uri 'none';frame-ancestors ${host}`
  );
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  if (req.url === '/index.html') {
    res.setHeader('Content-Type', 'text/html');
    res.end(input.html);
  } else if (req.url === '/baseline.html') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/baseline.js"></script></body></html>'
    );
  } else if (req.url === '/app.js' || req.url === '/baseline.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(req.url === '/app.js' ? input.javascript : input.baseline);
  } else if (req.url === '/app.css') {
    res.setHeader('Content-Type', 'text/css');
    res.end(input.css);
  } else if (req.url === '/assets/synthetic-device-image') {
    res.setHeader('Content-Type', 'image/png');
    res.end(Buffer.from(input.image, 'base64'));
  } else res.writeHead(404).end();
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await new Promise<void>((resolve, reject) => {
    parent.once('error', reject);
    parent.listen(43176, '127.0.0.1', resolve);
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.listen(43177, '127.0.0.1', resolve);
  });
  browser = await chromium.launch({
    ...browserProcessPolicy('chromium', process.env),
    headless: true,
    chromiumSandbox: true,
    timeout: 12000,
  });
  if (input.benchmark) {
    const context = await browser.newContext({
      viewport: { width: input.width, height: 844 },
      recordHar: { path: '/tmp/lab.har', content: 'omit' },
    });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });
    await context.addInitScript(installLabObservers);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(
      `${host}/${input.benchmark === 'client' ? 'baseline' : ''}`
    );
    const child = page.frames().find((frame) => frame.parentFrame());
    assert.ok(child);
    await child.getByRole('heading', { level: 1 }).waitFor();
    await child.locator('img').evaluateAll(async (elements) => {
      await Promise.all(
        elements.map((element) => (element as HTMLImageElement).decode())
      );
    });
    // Finite observation window, not a claimed lifetime/field metric.
    await page.waitForTimeout(1500);
    const frameBefore = await child.evaluate(readLabMetrics);
    const hostBefore = await page.evaluate(readLabMetrics);
    await child
      .getByRole('button', { name: 'Preview Ink', exact: true })
      .click();
    await page.waitForTimeout(100);
    const frameAfter = await child.evaluate(readLabMetrics);
    assert.equal(
      await child
        .getByRole('button', { name: 'Preview Ink', exact: true })
        .getAttribute('aria-pressed'),
      'true'
    );
    const screenshot = (await page.screenshot()).toString('base64');
    const result = {
      functionalOnly: false,
      cwvQualified: false,
      renderer: input.benchmark,
      browser: browser.version(),
      width: input.width,
      cache: 'cold-context',
      route: '/',
      frameLcpMs:
        frameBefore.lcpMs === null
          ? null
          : frameBefore.timeOrigin - hostBefore.timeOrigin + frameBefore.lcpMs,
      hostLcpMs: hostBefore.lcpMs,
      frameCls: frameBefore.cls,
      hostCls: hostBefore.cls,
      interactionDurationMs: frameAfter.interactionDurationMs,
      contentVisible: true,
      imagesDecoded: true,
      consoleErrors: errors.length,
      errors,
      screenshot,
      observationWindowMs: 1500,
      networkProfile: 'native-loopback',
      cpuProfile: 'native',
      hostTimeOrigin: hostBefore.timeOrigin,
      frameTimeOrigin: frameBefore.timeOrigin,
    };
    await context.tracing.stop({ path: '/tmp/lab-trace.zip' });
    await context.close();
    const har = readFileSync('/tmp/lab.har');
    const trace = readFileSync('/tmp/lab-trace.zip');
    assert.ok(har.length + trace.length < 4 * 1024 * 1024);
    console.log(
      JSON.stringify({
        ...result,
        har: har.toString('base64'),
        trace: trace.toString('base64'),
      })
    );
  } else {
    const noJs = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: input.width, height: 844 },
    });
    const page = await noJs.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(`${host}/baseline`);
    assert.equal(
      await page
        .frameLocator('iframe')
        .getByRole('heading', { level: 1 })
        .count(),
      0
    );
    await page.goto(`${host}/`);
    const staticFrame = page.frameLocator('iframe');
    const staticHeading = await staticFrame
      .getByRole('heading', { level: 1 })
      .innerText();
    assert.match(staticHeading, /orbit/i);
    const images = await staticFrame.locator('img').evaluateAll((elements) =>
      elements.map((el) => ({
        complete: (el as HTMLImageElement).complete,
        width: (el as HTMLImageElement).naturalWidth,
      }))
    );
    assert.ok(
      images.length > 0 &&
        images.every((image) => image.complete && image.width > 0)
    );
    const screenshot = (await page.screenshot()).toString('base64');
    await noJs.close();
    const interactive = await browser.newContext({
      viewport: { width: input.width, height: 844 },
    });
    const live = await interactive.newPage();
    live.setDefaultTimeout(5000);
    const errors: string[] = [];
    live.on('pageerror', (error) => errors.push(String(error)));
    await live.goto(`${host}/`);
    const frame = live.frameLocator('iframe');
    await frame.locator('html[data-baci-hydration="ready"]').waitFor();
    await frame
      .getByRole('button', { name: 'Preview Ink', exact: true })
      .click();
    assert.equal(
      await frame
        .getByRole('button', { name: 'Preview Ink', exact: true })
        .getAttribute('aria-pressed'),
      'true'
    );
    assert.deepEqual(errors, []);
    await interactive.close();
    await browser.close();
    browser = undefined;
    console.log(
      JSON.stringify({
        functionalOnly: true,
        cwvQualified: false,
        width: input.width,
        noJsHeading: staticHeading,
        baselineNoJsHeadingCount: 0,
        images,
        hydration: 'ready',
        colorInteraction: 'Ink',
        errors,
        screenshot,
      })
    );
  }
} finally {
  await browser?.close();
  parent.closeAllConnections();
  child.closeAllConnections();
  await Promise.all([
    new Promise<void>((resolve) => parent.close(() => resolve())),
    new Promise<void>((resolve) => child.close(() => resolve())),
  ]);
}
