import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';
import { inspectPublicRoutes } from './public-observation-routes';

const build = 'a'.repeat(64);
const origin = 'https://shop.example.com';
const frameUrl = `https://runtime.example.net/published/synthetic/${build}/index.html?path=%2F`;
const route = {
  path: '/',
  canonical: `${origin}/`,
  title: 'Synthetic store',
  frameUrl,
};

async function inspect(
  options: {
    parentBuild?: string;
    frameBuild?: string;
    title?: string;
    src?: string;
    sandbox?: string;
    ready?: boolean;
    delayed?: boolean;
  } = {}
) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await context.route('**/*', async (route) => {
      if (route.request().url() === `${origin}/`) {
        const iframe = `<iframe data-baci-experience-build="${options.parentBuild ?? build}" sandbox="${options.sandbox ?? 'allow-scripts'}" src="${options.src ?? frameUrl}"></iframe>`;
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<title>${options.title ?? 'Synthetic store'}</title><link rel="canonical" href="${origin}/">${options.delayed ? `<script>setTimeout(() => document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(iframe)}), 150)</script>` : iframe}`,
        });
      } else if (route.request().url() === frameUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<html data-baci-experience-build="${options.frameBuild ?? build}" data-baci-hydration="${options.ready === false ? 'pending' : 'ready'}"><body>Synthetic</body></html>`,
        });
      } else await route.abort();
    });
    return await inspectPublicRoutes({
      context,
      buildDigest: build,
      routes: [route],
      timeoutMs: 2000,
    });
  } finally {
    await context.close();
    await browser.close();
  }
}

it('observes a rendered parent and sandboxed frame in a real browser', async () => {
  await expect(inspect()).resolves.toEqual([
    {
      path: '/',
      canonical: `${origin}/`,
      title: 'Synthetic store',
      status: 200,
    },
  ]);
});

it('waits for a client-rendered frame to attach', async () => {
  await expect(inspect({ delayed: true })).resolves.toHaveLength(1);
});

it.each([
  { parentBuild: 'b'.repeat(64) },
  { frameBuild: 'b'.repeat(64) },
  { title: 'Wrong' },
  { src: 'https://other.example/' },
  { sandbox: 'allow-scripts allow-same-origin' },
  { ready: false },
])('rejects an inconsistent or unready browser rendering', async (options) => {
  await expect(inspect(options)).rejects.toThrow();
}, 10000);
