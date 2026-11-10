import { createElement, type ReactNode } from 'react';
import {
  type SemanticNode,
  validateSemanticSnapshot,
} from '@/lib/experience/semantic-data';
/** Trusted React elements only; extraction supplies data, never HTML markup. */
export function ExperienceSemanticFallback({
  snapshot,
  currentRevision,
  canonicalBase,
}: {
  snapshot: unknown;
  currentRevision: string;
  canonicalBase: string;
}) {
  const value = validateSemanticSnapshot(snapshot);
  if (value.revision !== currentRevision) throw Error('SNAPSHOT_STALE');
  const render = (node: SemanticNode, index: number): ReactNode =>
    'text' in node
      ? node.text
      : createElement(
          node.tag,
          {
            key: index,
            ...(node.href
              ? { href: `${canonicalBase.replace(/\/$/, '')}${node.href}` }
              : {}),
          },
          ...node.children.map(render)
        );
  return <main aria-label="Storefront content">{value.nodes.map(render)}</main>;
}
