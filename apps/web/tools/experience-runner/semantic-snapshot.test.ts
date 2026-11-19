import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import {
  renderSemanticSnapshot,
  semanticEngine,
  semanticText,
  validateSemanticSnapshot,
} from './semantic-snapshot';

const text = (value: string) => ({ text: value });
const base = { revision: 'synthetic-1', path: '/products/device' };
function extract(html: string) {
  const dom = new JSDOM(`<style>*{opacity:1}</style>${html}`);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle);
  try {
    const [metadata] = semanticEngine().queryAll(
      dom.window.document,
      'snapshot'
    );
    return validateSemanticSnapshot({
      ...base,
      nodes: JSON.parse(metadata.getAttribute('data-snapshot') ?? 'null'),
    });
  } finally {
    vi.unstubAllGlobals();
    dom.window.close();
  }
}
describe('bounded semantic fallback feasibility', () => {
  it('renders escaped text and canonical links without evaluating source', () => {
    const snapshot = validateSemanticSnapshot({
      ...base,
      nodes: [
        { tag: 'h1', children: [text('Synthetic <script> Device')] },
        { tag: 'p', children: [text('USD 10.00')] },
        { tag: 'a', href: '/products/device', children: [text('Device')] },
      ],
    });
    const html = renderSemanticSnapshot(snapshot);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('USD 10.00');
    expect(html).toContain('href="/products/device"');
  });
  it('rejects source attributes, scripts, unsafe links, excessive trees and stale data', () => {
    for (const node of [
      { tag: 'script', children: [] },
      { tag: 'p', onClick: 'evil', children: [] },
      { tag: 'a', href: 'https://private.invalid', children: [] },
      { tag: 'a', href: '//evil', children: [] },
      { tag: 'a', href: '/%2f%2fevil', children: [] },
      text('x'.repeat(16001)),
    ])
      expect(() =>
        validateSemanticSnapshot({ ...base, nodes: [node] })
      ).toThrow();
    expect(() =>
      validateSemanticSnapshot({
        ...base,
        nodes: Array.from({ length: 513 }, () => text('x')),
      })
    ).toThrow();
    expect(() =>
      validateSemanticSnapshot({
        ...base,
        path: `/${'a'.repeat(2000)}%`,
        nodes: [],
      })
    ).toThrow();
    expect(() =>
      validateSemanticSnapshot({ ...base, revision: '', nodes: [] })
    ).toThrow();
    expect(() =>
      renderSemanticSnapshot({ ...base, nodes: [] }, 'synthetic-2')
    ).toThrow('Stale');
  });
  it('excludes nested hidden/modal/style-hidden text while preserving visible descendants', () => {
    const snapshot = extract(
      '<h1>Public<span hidden>HIDDEN_CHILD</span><span style="display:none">CSS_CHILD</span><span aria-hidden="true">ARIA_CHILD</span><span> visible</span></h1><p>Price <span role="dialog">MODAL_CHILD</span>USD 10.00</p>'
    );
    expect(semanticText(snapshot.nodes)).toBe('Public visiblePrice USD 10.00');
    expect(JSON.stringify(snapshot)).not.toMatch(
      /HIDDEN_CHILD|CSS_CHILD|ARIA_CHILD|MODAL_CHILD/
    );
  });
  it('keeps nested inline links and emphasis inside headings in their original order', () => {
    const snapshot = extract(
      '<h1>Buy <a href="/products/phone"><em>Phone</em></a> today</h1><p>See <a href="/journal/design">our story</a> next.</p>'
    );
    const html = renderSemanticSnapshot(snapshot);
    expect(html).toContain(
      '<h1>Buy <a href="/products/phone"><em>Phone</em></a> today</h1>'
    );
    expect(html).toContain(
      '<p>See <a href="/journal/design">our story</a> next.</p>'
    );
  });
  it('preserves list structure and rejects excessive extraction nesting', () => {
    expect(
      renderSemanticSnapshot(
        extract('<ul><li>One</li><li>Two <strong>items</strong></li></ul>')
      )
    ).toContain('<ul><li>One</li><li>Two <strong>items</strong></li></ul>');
    expect(() =>
      validateSemanticSnapshot({
        ...base,
        nodes: [
          Array.from({ length: 15 }).reduce<unknown>(
            (node) => ({ tag: 'span', children: [node] }),
            text('deep')
          ),
        ],
      })
    ).toThrow();
  });
});
