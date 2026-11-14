import { expect, it, vi } from 'vitest';
import { fetchPublicPages } from './public-page-fetch';

const origin = 'https://shop.example.com';
const routes = [
  { path: '/', canonical: `${origin}/`, title: 'Synthetic shop' },
  {
    path: '/products/device',
    canonical: `${origin}/products/device`,
    title: 'Device',
  },
];
const resolve = async () => [{ address: '8.8.8.8', family: 4 }];
function html(title: string, canonical: string) {
  return `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${canonical}"></head><body><script>throw new Error('must never execute')</script><main>Store</main></body></html>`;
}
function fixture() {
  return vi.fn(async (url: URL) => ({
    response: new Response(
      html(url.pathname === '/' ? 'Synthetic shop' : 'Device', url.href),
      { headers: { 'content-type': 'text/html; charset=utf-8' } }
    ),
    close: async () => {},
  }));
}
it('fetches exactly the bound HTML pages without executing their scripts', async () => {
  const network = fixture();
  const pages = await fetchPublicPages(origin, routes, { resolve, network });
  expect(
    pages.map(({ path, title, canonical }) => ({ path, title, canonical }))
  ).toEqual(routes);
  expect(network.mock.calls.map(([url]) => url.href)).toEqual(
    routes.map((r) => r.canonical)
  );
});
it('recognizes canonical among whitespace-separated rel tokens and rejects duplicate canonicals', async () => {
  const document = html('Synthetic shop', `${origin}/`).replace(
    'rel="canonical"',
    'rel="alternate\tcanonical"'
  );
  const network = async () => ({
    response: new Response(document, {
      headers: { 'content-type': 'text/html' },
    }),
    close: async () => {},
  });
  await expect(
    fetchPublicPages(origin, [routes[0]], { resolve, network })
  ).resolves.toHaveLength(1);
  const duplicate = async () => ({
    response: new Response(
      document.replace(
        '</head>',
        `<link rel="canonical" href="${origin}/"></head>`
      ),
      { headers: { 'content-type': 'text/html' } }
    ),
    close: async () => {},
  });
  await expect(
    fetchPublicPages(origin, [routes[0]], { resolve, network: duplicate })
  ).rejects.toThrow('PUBLIC_PAGE_MISMATCH');
});
it('rejects foreign, duplicated, malformed and noncanonical routes before networking', async () => {
  for (const invalid of [
    [{ ...routes[0], canonical: 'https://other.example/' }],
    [routes[0], routes[0]],
    [{ ...routes[0], path: '//evil.example/' }],
    [{ ...routes[0], path: '/x?order=1' }],
  ]) {
    const network = fixture();
    await expect(
      fetchPublicPages(origin, invalid, { resolve, network })
    ).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  }
});
it('rejects bad SEO, duplicate metadata, non-HTML and private address resolution', async () => {
  for (const [body, mime] of [
    [html('Wrong title', `${origin}/`), 'text/html'],
    [html('Synthetic shop', 'https://other.example/'), 'text/html'],
    [
      html('Synthetic shop', `${origin}/`).replace(
        '</head>',
        '<title>Second</title></head>'
      ),
      'text/html',
    ],
    [
      html('Synthetic shop', `${origin}/`).replace(
        '<body>',
        '<body><meta http-equiv="refresh" content="0;url=https://other.example/">'
      ),
      'text/html',
    ],
    [html('Synthetic shop', `${origin}/`), 'text/plain'],
  ]) {
    const network = vi.fn(async () => ({
      response: new Response(body, { headers: { 'content-type': mime } }),
      close: async () => {},
    }));
    await expect(
      fetchPublicPages(origin, [routes[0]], { resolve, network })
    ).rejects.toThrow();
  }
  const network = fixture();
  await expect(
    fetchPublicPages(origin, [routes[0]], {
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
      network,
    })
  ).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
});

it('bounds markup complexity before building a DOM', async () => {
  const network = vi.fn(async () => ({
    response: new Response(
      html('Synthetic shop', `${origin}/`).replace(
        '<main>',
        `${'<i></i>'.repeat(10001)}<main>`
      ),
      { headers: { 'content-type': 'text/html' } }
    ),
    close: async () => {},
  }));
  await expect(
    fetchPublicPages(origin, [routes[0]], { resolve, network })
  ).rejects.toThrow('PUBLIC_PAGE_MISMATCH');
});
