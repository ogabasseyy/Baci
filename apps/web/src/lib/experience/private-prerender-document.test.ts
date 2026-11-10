import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { createPrivatePrerenderDocument } from './private-prerender-document';

const resources = [
  {
    path: 'app.js',
    url: `http://127.0.0.1:4101/resource/${'a'.repeat(64)}/app.js`,
    digest: 'b'.repeat(64),
  },
];
it('permits only the explicitly trusted HTTPS resource origin, preserving the local default', () => {
  const executionOrigin = 'https://output.baci-runtime.test';
  const remote = resources.map((resource) => ({
    ...resource,
    url: resource.url.replace('http://127.0.0.1:4101', executionOrigin),
  }));
  expect(() =>
    createPrivatePrerenderDocument('<main>Orbit</main>', {} as never, remote)
  ).toThrow();
  expect(
    createPrivatePrerenderDocument('<main>Orbit</main>', {} as never, remote, {
      executionOrigin,
    })
  ).toContain('sha256-');
  expect(() =>
    createPrivatePrerenderDocument('<main>Orbit</main>', {} as never, remote, {
      executionOrigin: 'https://evil.test',
    })
  ).toThrow();
});
it('preserves full custom markup and embeds escaped bootstrap in a separate-origin document', () => {
  const html = createPrivatePrerenderDocument(
    '<main><h1>Full custom</h1><button>Choose</button></main>',
    {
      catalog: { revision: '</script><script>bad</script>', products: [] },
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'r',
      },
      capabilities: [],
    },
    resources
  );
  expect(html).toContain('<h1>Full custom</h1>');
  expect(html).not.toContain('</script><script>bad');
  expect(html).toContain('baci-prerender-bootstrap');
});
it.each([
  '<script>alert(1)</script>',
  '<iframe src="https://evil.test"></iframe>',
  '<base href="https://evil.test">',
  '<meta http-equiv="refresh" content="0;url=https://evil.test">',
  '<img src="x" onerror="bad()">',
  '<div id="baci-prerender-bootstrap">fake</div>',
  '<object data="x"></object>',
])('rejects active or clobbering markup: %s', (markup) => {
  expect(() =>
    createPrivatePrerenderDocument(markup, {} as never, resources)
  ).toThrow('BUILD_FAILED');
});

it('delivers prerendered controls inert before the hydration module can execute', () => {
  const html = createPrivatePrerenderDocument(
    '<main><button>Custom interaction</button></main>',
    {
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'r',
      },
      catalog: { revision: 'r', products: [] },
      capabilities: [],
    },
    resources
  );
  const document = new JSDOM(html).window.document;
  expect(document.querySelector('#root')?.hasAttribute('inert')).toBe(true);
  expect(document.documentElement.dataset.baciHydration).toBe('pending');
  expect(document.querySelector('button')?.textContent).toBe(
    'Custom interaction'
  );
});

it('accepts React responsive-image preloads only for trusted asset candidates', async () => {
  const { createElement } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const images = ['small', 'large'].map((name) => ({
    path: `assets/${name}`,
    url: `http://127.0.0.1:4101/resource/${'a'.repeat(64)}/assets/${name}`,
    digest: 'b'.repeat(64),
  }));
  const markup = renderToString(
    createElement('img', {
      src: images[0].url,
      srcSet: `${images[0].url} 1x, ${images[1].url} 2x`,
      sizes: '100vw',
      loading: 'eager',
      alt: 'Synthetic product',
    })
  );
  expect(markup.toLowerCase()).toContain('imagesrcset');
  const doc = createPrivatePrerenderDocument(markup, {} as never, [
    ...resources,
    ...images,
  ]);
  expect(doc.toLowerCase()).toContain('imagesrcset');
  expect(doc).toContain(images[1].url);
  for (const candidates of [
    `${images[0].url} 1x, https://evil.test/image 2x`,
    `${images[0].url} nope`,
    '',
    `${images[0].url} 0x`,
  ]) {
    expect(() =>
      createPrivatePrerenderDocument(
        `<link rel="preload" as="image" imagesrcset="${candidates}">`,
        {} as never,
        [...resources, ...images]
      )
    ).toThrow('BUILD_FAILED');
  }
});
