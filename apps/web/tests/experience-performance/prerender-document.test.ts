import type { PublicBootstrap } from '@baci/shared/experience';
import { expect, it } from 'vitest';
import { prerenderDocument } from './prerender-document';

const bootstrap: PublicBootstrap = {
  route: {
    epoch: 1,
    routeId: 'home',
    params: {},
    canonicalPath: '/',
    publicDataRevision: 'r',
  },
  catalog: { products: [], revision: 'r' },
  capabilities: [],
};
it('keeps initial content in HTML and escapes public JSON without changing its data', () => {
  const data = {
    ...bootstrap,
    currency: '</script><script>bad()</script>&\u2028',
  };
  const html = prerenderDocument(
    '<h1>Real custom content</h1>',
    data,
    '/* script */',
    'body{}'
  );
  expect(html).toContain('<div id="root"><h1>Real custom content</h1></div>');
  const payload = html.match(/type="application\/json">(.*?)<\/script>/s)?.[1];
  expect(JSON.parse(payload ?? 'null').publicData).toEqual(data);
  expect(html).not.toContain('<script>bad()');
  expect(html).toContain('integrity="sha256-');
});
it('rejects oversized documents before serving even if a renderer returned one', () => {
  expect(() =>
    prerenderDocument('x'.repeat(2097153), bootstrap, '', '')
  ).toThrow('Prerender document budget');
});
