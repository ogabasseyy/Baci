import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { verifyServedPreview } from './preview-served-smoke.mjs';

const origin = 'https://baci-abcd-basseys-projects-d7395611.vercel.app';
const html =
  '<html><head><link rel="preload" as="font" href="/_next/static/media/a.woff2"></head><body><section data-ogabassey-hero><img src="hero.webp"></section></body></html>';
const ok = (body, type) => ({ status: 200, contentType: type, body });

test('the checked font path matches the storefront font declaration', () => {
  const css = readFileSync('apps/web/src/app/inter-naira-font.css', 'utf8');
  assert.match(css, /\/fonts\/inter-naira\.61440e0f45d4\.woff2/);
});

test('checks the actual deferred naira font without requiring a preload', async () => {
  const calls = [];
  await verifyServedPreview({
    origin,
    route: '/ogabassey',
    request: async (url) => {
      calls.push(url);
      return url.endsWith('.woff2')
        ? ok('font', 'font/woff2')
        : ok(
            '<section data-ogabassey-hero><img src="hero.webp"></section>',
            'text/html'
          );
    },
  });
  assert.deepEqual(calls, [
    `${origin}/ogabassey`,
    `${origin}/fonts/inter-naira.61440e0f45d4.woff2`,
  ]);
});

test('checks the home hero payload and each served font', async () => {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    return url.endsWith('.woff2')
      ? ok('font', 'font/woff2')
      : ok(html, 'text/html');
  };
  await verifyServedPreview({ origin, route: '/ogabassey', request });
  assert.deepEqual(calls, [
    `${origin}/ogabassey`,
    `${origin}/_next/static/media/a.woff2`,
    `${origin}/fonts/inter-naira.61440e0f45d4.woff2`,
  ]);
});

test('rejects missing hero, missing fonts, redirects and HTML font errors', async () => {
  for (const body of [
    '<html>404</html>',
    '<html><section data-ogabassey-hero></section></html>',
  ]) {
    await assert.rejects(
      verifyServedPreview({
        origin,
        route: '/ogabassey',
        request: async () => ok(body, 'text/html'),
      })
    );
  }
  await assert.rejects(
    verifyServedPreview({
      origin,
      route: '/ogabassey',
      request: async (url) =>
        url.endsWith('.woff2')
          ? ok('not a font', 'text/html')
          : ok(html, 'text/html'),
    }),
    /font/i
  );
  await assert.rejects(
    verifyServedPreview({
      origin,
      route: '/ogabassey',
      request: async () => ({
        status: 302,
        contentType: 'text/html',
        body: html,
      }),
    }),
    /status/i
  );
});

test('never sends authenticated requests to another origin', async () => {
  const calls = [];
  const foreign = html.replace(
    '/_next/static/media/a.woff2',
    'https://evil.example/a.woff2'
  );
  await assert.rejects(
    verifyServedPreview({
      origin,
      route: '/ogabassey',
      request: async (url) => {
        calls.push(url);
        return ok(foreign, 'text/html');
      },
    }),
    /font/i
  );
  assert.deepEqual(calls, [`${origin}/ogabassey`]);
});

test('does not mistake scripts or unrelated images for the hero payload', async () => {
  const page =
    '<link rel="preload" as="font" href="/_next/static/media/a.woff2"><script>"<section data-ogabassey-hero>"</script><img src="unrelated.jpg">';
  await assert.rejects(
    verifyServedPreview({
      origin,
      route: '/ogabassey',
      request: async () => ok(page, 'text/html'),
    }),
    /hero/i
  );
  const unrelated =
    '<link rel="preload" as="font" href="/_next/static/media/a.woff2"><section data-ogabassey-hero></section><img src="unrelated.jpg">';
  await assert.rejects(
    verifyServedPreview({
      origin,
      route: '/ogabassey',
      request: async () => ok(unrelated, 'text/html'),
    }),
    /hero/i
  );
});
