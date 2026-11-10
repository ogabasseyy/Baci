import { expect, it } from 'vitest';
import {
  semanticElements,
  semanticText,
  validateSemanticSnapshot,
} from './semantic-data';

it('retains safe text and native canonical links while rejecting executable attributes and depth bombs', () => {
  const v = validateSemanticSnapshot({
    path: '/',
    revision: 'r',
    nodes: [
      {
        tag: 'a',
        href: '/products/device',
        children: [{ text: 'Synthetic <script>' }],
      },
    ],
  });
  expect(semanticText(v.nodes)).toContain('<script>');
  expect(semanticElements(v.nodes)[0].href).toBe('/products/device');
  for (const node of [
    { tag: 'script', children: [] },
    { tag: 'a', href: 'https://external.test', children: [] },
    { tag: 'span', children: [], onclick: 'attack' },
  ])
    expect(() =>
      validateSemanticSnapshot({ path: '/', revision: 'r', nodes: [node] })
    ).toThrow();
});
