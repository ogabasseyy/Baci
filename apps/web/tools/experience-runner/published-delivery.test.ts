import type { PublicBootstrap } from '@baci/shared/experience';
import { expect, it, vi } from 'vitest';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import type { createPublicOutputReader } from '../../src/lib/experience/public-output-reader';
import { createProductionPublishedDelivery } from './published-delivery';

function fixture(
  assets: { assetId: string }[] = [],
  css = 'body{color:black}'
) {
  let active = true;
  const hostOrigin = 'https://shop.merchant.test';
  const executionOrigin = 'https://output.baci-runtime.test';
  const buildDigest = 'a'.repeat(64);
  const reader = {
    manifest: vi.fn(async () =>
      active
        ? { merchantId: 'synthetic', buildDigest, hostOrigin, assets }
        : null
    ),
    read: vi.fn(async (_slug: string, _build: string, path: string) => {
      const bytes = Buffer.from(path === 'app.js' ? 'export{}' : css);
      return {
        path,
        bytes,
        digest: digestBytes(bytes),
        mime: path === 'app.js' ? 'text/javascript' : 'text/css',
      };
    }),
  };
  const render = vi.fn(async () => ({
    markup: '<main><h1>Orbit</h1><button>Ink</button></main>',
    bootstrap: {
      catalog: { products: [], revision: 'synthetic' },
      capabilities: [],
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'synthetic',
      },
    } as PublicBootstrap,
  }));
  const deliver = createProductionPublishedDelivery({
    reader: reader as unknown as ReturnType<typeof createPublicOutputReader>,
    hostOrigin,
    executionOrigin,
    render,
  });
  const base = `${executionOrigin}/published/qa1/${buildDigest}/`;
  return {
    deliver,
    base,
    reader,
    render,
    revoke: () => {
      active = false;
    },
  };
}
it('delivers custom prerendered controls with SRI, strict CSP and no writes', async () => {
  const f = fixture();
  const response = await f.deliver(new Request(`${f.base}index.html?path=%2F`));
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('<h1>Orbit</h1>');
  expect(html).toContain('inert');
  expect(html).toContain('sha256-');
  expect(response.headers.get('content-security-policy')).toContain(
    "connect-src 'none'"
  );
  expect(response.headers.has('set-cookie')).toBe(false);
  for (const path of ['app.js', 'app.css'])
    expect((await f.deliver(new Request(f.base + path))).status).toBe(200);
  f.revoke();
  expect((await f.deliver(new Request(`${f.base}app.js`))).status).toBe(404);
});
it('serves public output with a fixed wildcard rather than reflecting the caller origin', async () => {
  const f = fixture();
  const response = await f.deliver(
    new Request(`${f.base}app.js`, {
      headers: { origin: 'https://evil.example' },
    })
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  expect(response.headers.has('set-cookie')).toBe(false);
});
it('withdraws output if publication changes while reading static resources or rendering HTML', async () => {
  const f = fixture();
  f.reader.read.mockImplementationOnce(async (_s, _b, path) => {
    f.revoke();
    return {
      path,
      mime: 'text/javascript',
      bytes: Buffer.from('export{}'),
      digest: digestBytes('export{}'),
    };
  });
  expect((await f.deliver(new Request(`${f.base}app.js`))).status).toBe(404);
  const g = fixture();
  g.render.mockImplementationOnce(async () => {
    g.revoke();
    return { markup: '<main>stale</main>', bootstrap: {} as PublicBootstrap };
  });
  expect((await g.deliver(new Request(`${g.base}index.html`))).status).toBe(
    404
  );
});
it('rejects active SSR markup and arbitrary files, origins, query fields and mutations', async () => {
  const f = fixture();
  f.render.mockResolvedValueOnce({
    markup: '<script>bad()</script>',
    bootstrap: {} as PublicBootstrap,
  });
  expect((await f.deliver(new Request(`${f.base}index.html`))).status).toBe(
    404
  );
  for (const request of [
    new Request(`${f.base}app.js`, { method: 'POST' }),
    new Request(`${f.base}source.tsx`),
    new Request(`${f.base}app.js?path=/`),
    new Request(`${f.base}index.html?path=/&path=/other`),
    new Request(`${f.base}index.html?secret=x`),
    new Request(
      `${f.base}app.js`.replace('output.baci-runtime.test', 'evil.test')
    ),
  ])
    expect((await f.deliver(request)).status).toBe(404);
});

it('rewrites duplicate and prefix-sharing declared CSS asset IDs exactly once', async () => {
  const assetId = 'a'.repeat(64);
  const longerId = `${assetId}-variant`;
  const f = fixture(
    [{ assetId }, { assetId }, { assetId: longerId }],
    `a{background:url(/assets/${assetId})}b{background:url("/assets/${longerId}")}`
  );
  const response = await f.deliver(new Request(`${f.base}app.css`));
  expect(response.status).toBe(200);
  const base = new URL(f.base).pathname;
  expect(await response.text()).toBe(
    `a{background:url(${base}assets/${assetId})}b{background:url("${base}assets/${longerId}")}`
  );
});
