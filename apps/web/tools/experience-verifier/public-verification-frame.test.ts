import { expect, it, vi } from 'vitest';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { createProductionPublishedDelivery } from '../experience-runner/published-delivery';
import { fetchPublicFrames } from './public-verification-frame';

const build = 'a'.repeat(64);
const script = 'b'.repeat(64);
const css = 'c'.repeat(64);
const binding = {
  slug: 'synthetic',
  buildDigest: build,
  canonicalBase: 'https://shop.example',
  scriptDigest: script,
  styleDigest: css,
};
const execution = 'https://runtime.example';
const base = `${execution}/published/synthetic/${build}`;
const integrity = (digest: string) =>
  `sha256-${Buffer.from(digest, 'hex').toString('base64')}`;
const html = `<!doctype html><html data-baci-experience-build="${build}"><head><link rel="stylesheet" href="${base}/app.css" integrity="${integrity(css)}" crossorigin="anonymous"></head><body><div id="root" inert>Store</div><script id="baci-prerender-bootstrap" type="application/json">{}</script><script type="module" src="${base}/app.js" integrity="${integrity(script)}" crossorigin="anonymous"></script></body></html>`;
const resolve = async () => [{ address: '8.8.8.8', family: 4 }];
const response = (
  body: string,
  csp = "default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self';font-src 'self';connect-src 'none';worker-src 'none';form-action 'none';base-uri 'none';frame-ancestors https://shop.example"
) => ({
  response: new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': csp,
    },
  }),
  close: async () => {},
});

it('fetches route-bound frames and validates build, integrity and browser security policy', async () => {
  const network = vi.fn(async () => response(html));
  const frames = await fetchPublicFrames(
    binding,
    execution,
    [{ path: '/' }, { path: '/products/device' }],
    { resolve, network }
  );
  expect(frames.map((frame) => frame.url)).toEqual([
    `${base}/index.html?path=%2F`,
    `${base}/index.html?path=%2Fproducts%2Fdevice`,
  ]);
  expect(network).toHaveBeenCalledTimes(2);
});

it('rejects unbound builds, missing integrity, altered policy, and private DNS', async () => {
  for (const reply of [
    response(html.replace(build, 'd'.repeat(64))),
    response(html.replace(integrity(script), integrity(css))),
    response(html, 'default-src *'),
    response(
      html.replace(
        '</body>',
        '<script src="https://evil.example/a.js"></script></body>'
      )
    ),
  ]) {
    await expect(
      fetchPublicFrames(binding, execution, [{ path: '/' }], {
        resolve,
        network: async () => reply,
      })
    ).rejects.toThrow();
  }
  const network = vi.fn();
  await expect(
    fetchPublicFrames(binding, execution, [{ path: '/' }], {
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
      network,
    })
  ).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
});

it('rejects duplicate and invalid route paths before any request', async () => {
  const network = vi.fn();
  for (const paths of [
    [{ path: '/' }, { path: '/' }],
    [{ path: '//evil.example' }],
    [{ path: '/?x=1' }],
  ]) {
    await expect(
      fetchPublicFrames(binding, execution, paths, { resolve, network })
    ).rejects.toThrow();
  }
  expect(network).not.toHaveBeenCalled();
});

it('accepts the actual production delivery document and its generated integrity values', async () => {
  const files = { 'app.js': 'export {}', 'app.css': 'body { color: red }' };
  const actual = {
    ...binding,
    scriptDigest: digestBytes(files['app.js']),
    styleDigest: digestBytes(files['app.css']),
  };
  const reader = {
    manifest: async () => ({
      buildDigest: build,
      hostOrigin: binding.canonicalBase,
      merchantId: 'synthetic',
      assets: [],
    }),
    read: async (_slug: string, _build: string, path: keyof typeof files) => ({
      path,
      bytes: Buffer.from(files[path]),
      mime: path.endsWith('.js') ? 'text/javascript' : 'text/css',
    }),
  };
  const delivery = createProductionPublishedDelivery({
    executionOrigin: execution,
    hostOrigin: binding.canonicalBase,
    reader: reader as never,
    render: async () => ({
      markup: '<main>Store</main>',
      bootstrap: {} as never,
    }),
  });
  const frames = await fetchPublicFrames(actual, execution, [{ path: '/' }], {
    resolve,
    network: async (url) => ({
      response: await delivery(new Request(url)),
      close: async () => {},
    }),
  });
  expect(frames[0].bytes.toString()).toContain('<main>Store</main>');
});
