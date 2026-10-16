// Opt-in native-codec compatibility fixture, NOT a CWV/performance runner.
// Runtime is an isolated pinned package; never installs into the app workspace.

import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Synthetic 48x48 solid-color images, generated with sharp; no merchant bytes.
const AVIF =
  'AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAACYAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAADAAAAAwAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAubWRhdBIACgk4FW+9pAQ0GkAyFxlCYwTAADQAAJfK4KreTJYOrTCsvv4g';
const WEBP =
  'UklGRkgAAABXRUJQVlA4IDwAAABwAwCdASowADAAPm02mEkkIyKhI4gAgA2JZwB2AABBSiGQT4AA/u4KZ//cGZ9XY4f/+A3Xxaw/R6HgAAA=';

export function codecProblems(result) {
  const problems = [];
  if (result.capabilities?.avif !== false)
    problems.push('AVIF decoding is supported');
  if (result.capabilities?.webp !== true)
    problems.push('WebP decoding not proven');
  for (const key of ['hydrated', 'interactive', 'unchanged']) {
    if (result.state?.[key] !== true) problems.push(`${key} proof failed`);
  }
  if (result.state?.sources !== 2) problems.push('Picture sources changed');
  if (!(result.state?.naturalWidth > 0))
    problems.push('Fallback did not decode');
  try {
    if (new URL(result.state.currentSrc).pathname !== '/fallback.webp')
      problems.push('Wrong selected image');
  } catch {
    problems.push('Missing selected image');
  }
  if (!result.requests?.includes('/fallback.webp'))
    problems.push('WebP was not requested');
  if (result.requests?.includes('/hero.avif'))
    problems.push('AVIF was requested');
  if (!Array.isArray(result.errors) || result.errors.length)
    problems.push('Console/page errors');
  if (!Array.isArray(result.failures) || result.failures.length)
    problems.push('Request failures');
  return problems;
}

async function main() {
  const runtime = process.env.PILOT_CODEC_RUNTIME;
  const output = process.env.PILOT_CODEC_OUTPUT;
  if (!runtime || !output)
    throw new Error('PILOT_CODEC_RUNTIME and PILOT_CODEC_OUTPUT are required');
  const require = createRequire(join(resolve(runtime), 'package.json'));
  const { webkit } = require('playwright');
  const { build } = require('esbuild');
  const React = require('react');
  const { renderToString } = require('react-dom/server');
  function Fixture() {
    const [count, setCount] = React.useState(0);
    React.useEffect(() => {
      window.fixtureHydrated = true;
    }, []);
    return React.createElement(
      'div',
      null,
      React.createElement(
        'picture',
        null,
        React.createElement('source', {
          type: 'image/avif',
          srcSet: '/hero.avif 48w',
          sizes: '48px',
        }),
        React.createElement('source', {
          type: 'image/webp',
          srcSet: '/fallback.webp 48w',
          sizes: '48px',
        }),
        React.createElement('img', {
          src: '/fallback.webp',
          width: 48,
          height: 48,
          alt: 'Codec fixture',
          loading: 'lazy',
        })
      ),
      React.createElement(
        'button',
        { type: 'button', onClick: () => setCount(count + 1) },
        `Clicks: ${count}`
      )
    );
  }
  const bundled = await build({
    stdin: {
      contents: `import * as React from 'react'; import {hydrateRoot} from 'react-dom/client';
      const Fixture = ${Fixture.toString()};
      window.initialPicture = document.querySelector('picture').outerHTML;
      hydrateRoot(document.getElementById('root'), React.createElement(Fixture), {onRecoverableError: e => console.error(e.message)});`,
      resolveDir: resolve(runtime),
    },
    bundle: true,
    write: false,
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="preload" as="image" type="image/avif" href="/hero.avif"></head><body><div id="root">${renderToString(React.createElement(Fixture))}</div><script src="/hydrate.js"></script></body></html>`;
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const resources = new Map([
      ['/', ['text/html', html]],
      ['/hydrate.js', ['text/javascript', bundled.outputFiles[0].contents]],
      ['/hero.avif', ['image/avif', Buffer.from(AVIF, 'base64')]],
      ['/fallback.webp', ['image/webp', Buffer.from(WEBP, 'base64')]],
    ]);
    if (request.url === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    const entry = resources.get(request.url);
    response.writeHead(entry ? 200 : 404, {
      'Content-Type': entry?.[0] ?? 'text/plain',
      'Cache-Control': 'no-store',
    });
    response.end(entry?.[1] ?? 'Not found');
  });
  const result = {
    purpose: 'Native codec and hydration fixture only; no pilot/CWV clearance',
    platform: process.platform,
    commit: process.env.GITHUB_SHA ?? null,
    playwright: require('playwright/package.json').version,
    react: React.version,
    requests,
    errors: [],
    failures: [],
    ok: false,
  };
  let browser;
  try {
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', accept);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await webkit.launch({ headless: true });
    result.browser = browser.version();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    // No codec flags, HTML rewriting or AVIF request interception.
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      result.failures.push('Foreign request blocked');
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => result.errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') result.errors.push(message.text());
    });
    page.on('requestfailed', (request) =>
      result.failures.push(request.failure()?.errorText ?? 'unknown')
    );
    page.on('response', (response) => {
      if (response.status() >= 400)
        result.failures.push(`HTTP ${response.status()}`);
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.fixtureHydrated === true);
    await page.getByRole('button', { name: 'Clicks: 0' }).click();
    await page.getByRole('button', { name: 'Clicks: 1' }).waitFor();
    result.state = await page.evaluate(() => ({
      hydrated: window.fixtureHydrated === true,
      interactive: document.querySelector('button').textContent === 'Clicks: 1',
      unchanged:
        window.initialPicture === document.querySelector('picture').outerHTML,
      sources: document.querySelectorAll('picture source').length,
      currentSrc: document.querySelector('img').currentSrc,
      naturalWidth: document.querySelector('img').naturalWidth,
    }));
    // Data URLs establish codec support independently, without network/cache effects.
    result.capabilities = await page.evaluate(
      async ({ avif, webp }) => {
        const decoded = async (type, bytes) => {
          const image = new Image();
          image.src = `data:image/${type};base64,${bytes}`;
          try {
            await image.decode();
            return image.naturalWidth === 48;
          } catch {
            return false;
          }
        };
        return {
          avif: await decoded('avif', avif),
          webp: await decoded('webp', webp),
        };
      },
      { avif: AVIF, webp: WEBP }
    );
    result.problems = codecProblems(result);
    result.ok = result.problems.length === 0;
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, 'fixture.png') });
  } catch (error) {
    result.ok = false;
    result.errors.push(String(error));
  } finally {
    await browser?.close();
    if (server.listening) await new Promise((accept) => server.close(accept));
    await mkdir(output, { recursive: true });
    await writeFile(
      join(output, 'result.json'),
      JSON.stringify(result, null, 2)
    );
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
