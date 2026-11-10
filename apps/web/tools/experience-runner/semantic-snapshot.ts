import type { Frame } from 'playwright-core';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  type SemanticNode,
  validateSemanticSnapshot,
} from '../../src/lib/experience/semantic-data';

export {
  type SemanticNode,
  type SemanticSnapshot,
  semanticElements,
  semanticText,
  validateSemanticSnapshot,
} from '../../src/lib/experience/semantic-data';
export function renderSemanticSnapshot(
  value: unknown,
  currentRevision?: string
): string {
  const snapshot = validateSemanticSnapshot(value);
  if (currentRevision !== undefined && snapshot.revision !== currentRevision)
    throw Error('Stale semantic snapshot');
  function render(node: SemanticNode, index: number): ReactNode {
    return 'text' in node
      ? node.text
      : createElement(
          node.tag,
          { key: index, ...(node.href ? { href: node.href } : {}) },
          ...node.children.map(render)
        );
  }
  return renderToStaticMarkup(
    createElement(
      'main',
      { 'aria-label': 'Semantic fallback' },
      ...snapshot.nodes.map(render)
    )
  );
}
/** Public content-script API isolates native DOM getters from authored replacements. */
export function semanticEngine() {
  function queryAll(root: Document | Element, selector: string): Element[] {
    if (selector !== 'snapshot') throw Error('Unknown semantic selector');
    const owner = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
    if (!owner) throw Error('Missing semantic document');
    const allowed = new Set([
      'h1',
      'h2',
      'h3',
      'p',
      'a',
      'ul',
      'ol',
      'li',
      'figcaption',
      'span',
      'strong',
      'em',
    ]);
    let count = 0;
    let characters = 0;
    function visible(element: Element): boolean {
      if (
        element.closest(
          '[hidden],[aria-hidden="true"],[role="dialog"],dialog,script,style,template,button,input,select,textarea,noscript'
        )
      )
        return false;
      for (
        let parent: Element | null = element;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (
          style.display === 'none' ||
          style.visibility !== 'visible' ||
          Number(style.opacity) === 0
        )
          return false;
      }
      return true;
    }
    type Tree =
      | { text: string }
      | { tag: string; children: Tree[]; href?: string };
    function text(value: string): Tree[] {
      characters += value.length;
      if (characters > 16000 || ++count > 512)
        throw Error('Semantic text budget');
      return [{ text: value }];
    }
    function walk(node: Node, depth: number): Tree[] {
      if (depth > 64) throw Error('DOM extraction depth budget');
      if (node.nodeType === 3) {
        const parent = node.parentElement;
        return parent && visible(parent) && node.textContent
          ? text(node.textContent.replace(/\s+/g, ' '))
          : [];
      }
      if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11)
        return [];
      const element = node.nodeType === 1 ? (node as Element) : null;
      if (element && !visible(element)) return [];
      const tag = element?.tagName.toLowerCase();
      if (tag === 'canvas') {
        const caption = element?.closest('figure')?.querySelector('figcaption');
        const label = element?.getAttribute('aria-label');
        if (caption && visible(caption)) return [];
        if (!label) throw Error('Canvas requires a semantic alternative');
        return [{ tag: 'span', children: text(label) }];
      }
      if (tag === 'img') {
        const alt = element?.getAttribute('alt');
        return alt ? [{ tag: 'span', children: text(alt) }] : [];
      }
      const children = Array.from(node.childNodes).flatMap((child) =>
        walk(child, depth + 1)
      );
      const shadow = element?.shadowRoot;
      if (shadow) children.push(...walk(shadow, depth + 1));
      if (!tag || !allowed.has(tag) || !children.length) return children;
      if (++count > 512) throw Error('Semantic node budget');
      const href = element?.getAttribute('href');
      return [
        {
          tag,
          children,
          ...(tag === 'a' &&
          href &&
          href.length <= 512 &&
          /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(href)
            ? { href }
            : {}),
        },
      ];
    }
    const nodes = walk(root.nodeType === 9 ? (root as Document).body : root, 0);
    const serialized = JSON.stringify(nodes);
    if (new TextEncoder().encode(serialized).byteLength > 90 * 1024)
      throw Error('Semantic response budget');
    // Detached metadata is invisible to source mutation observers and the authored DOM.
    const metadata = owner.createElement('span');
    metadata.setAttribute('data-snapshot', serialized);
    return [metadata];
  }
  return {
    queryAll,
    query: (root: Document | Element, selector: string) =>
      queryAll(root, selector)[0] ?? null,
  };
}
export async function collectSemanticNodes(
  frame: Frame
): Promise<SemanticNode[]> {
  const raw = await frame
    .locator('baciSemantic=snapshot')
    .getAttribute('data-snapshot');
  if (raw === null || raw.length > 92 * 1024)
    throw Error('Missing or oversized semantic extraction');
  return validateSemanticSnapshot({
    path: '/',
    revision: 'capture',
    nodes: JSON.parse(raw),
  }).nodes;
}
