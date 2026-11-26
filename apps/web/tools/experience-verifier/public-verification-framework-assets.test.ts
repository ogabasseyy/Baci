import { expect, it, vi } from 'vitest';
import { fetchFrameworkAssets } from './public-verification-framework-assets';

const origin = 'https://shop.example.com';
const page = (html: string) => ({
  canonical: `${origin}/`,
  bytes: Buffer.from(html),
});
const resolve = async () => [{ address: '8.8.8.8', family: 4 }];

it('fetches only unique same-origin framework scripts and styles referenced by verified pages', async () => {
  const network = vi.fn(async (url: URL) => ({
    response: new Response('synthetic', {
      headers: {
        'content-type': url.pathname.endsWith('.css')
          ? 'text/css'
          : 'text/javascript',
      },
    }),
    close: async () => {},
  }));
  const html =
    '<script src="/_next/static/chunks/a.js"></script><link rel="stylesheet" href="/_next/static/css/b.css"><script src="/_next/static/chunks/a.js"></script><script src="https://other.example/_next/static/chunks/x.js"></script>';
  const assets = await fetchFrameworkAssets(origin, [page(html)], {
    resolve,
    network,
  });
  expect(assets.map((asset) => asset.url)).toEqual([
    `${origin}/_next/static/chunks/a.js`,
    `${origin}/_next/static/css/b.css`,
  ]);
  expect(network).toHaveBeenCalledTimes(2);
});

it('rejects private DNS and mismatched asset content types', async () => {
  const html = '<script src="/_next/static/chunks/a.js"></script>';
  const network = vi.fn(async () => ({
    response: new Response('not javascript', {
      headers: { 'content-type': 'text/html' },
    }),
    close: async () => {},
  }));
  await expect(
    fetchFrameworkAssets(origin, [page(html)], { resolve, network })
  ).rejects.toThrow();
  network.mockClear();
  await expect(
    fetchFrameworkAssets(origin, [page(html)], {
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
      network,
    })
  ).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
});

it('does not fetch traversal, query-bearing, encoded or foreign asset references', async () => {
  const network = vi.fn();
  const html =
    '<script src="/_next/static/../private.js"></script><script src="/_next/static/a.js?x=1"></script><script src="/_next/static/%61.js"></script><link rel="stylesheet" href="//other.example/_next/static/a.css">';
  await expect(
    fetchFrameworkAssets(origin, [page(html)], { resolve, network })
  ).resolves.toEqual([]);
  expect(network).not.toHaveBeenCalled();
});
