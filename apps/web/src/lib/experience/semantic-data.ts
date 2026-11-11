const TAGS = [
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
] as const;
type SemanticTag = (typeof TAGS)[number];
export type SemanticNode =
  | { text: string }
  | { tag: SemanticTag; children: SemanticNode[]; href?: string };
export interface SemanticSnapshot {
  revision: string;
  path: string;
  nodes: SemanticNode[];
}
function canonicalPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 512 &&
    /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(value)
  );
}
export function semanticText(nodes: SemanticNode[]): string {
  return nodes
    .map((n) => ('text' in n ? n.text : semanticText(n.children)))
    .join('');
}
export function semanticElements(
  nodes: SemanticNode[]
): Extract<SemanticNode, { tag: SemanticTag }>[] {
  return nodes.flatMap((node) =>
    'tag' in node ? [node, ...semanticElements(node.children)] : []
  );
}
/** Bounded semantic data only; never source HTML, script, CSS or arbitrary attributes. */
export function validateSemanticSnapshot(value: unknown): SemanticSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid snapshot');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (k) => !['revision', 'path', 'nodes'].includes(k)
    ) ||
    typeof input.revision !== 'string' ||
    input.revision.length < 1 ||
    input.revision.length > 128 ||
    !canonicalPath(input.path) ||
    !Array.isArray(input.nodes)
  )
    throw Error('Invalid snapshot envelope');
  let count = 0;
  let characters = 0;
  function parse(raw: unknown, depth: number): SemanticNode {
    if (
      ++count > 512 ||
      depth > 12 ||
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw)
    )
      throw Error('Semantic tree budget');
    const node = raw as Record<string, unknown>;
    if ('text' in node) {
      if (Object.keys(node).length !== 1 || typeof node.text !== 'string')
        throw Error('Invalid semantic text');
      characters += node.text.length;
      if (characters > 16000) throw Error('Semantic text budget');
      return { text: node.text };
    }
    if (
      Object.keys(node).some((k) => !['tag', 'children', 'href'].includes(k)) ||
      !(TAGS as readonly unknown[]).includes(node.tag) ||
      !Array.isArray(node.children)
    )
      throw Error('Unsafe semantic node');
    if (
      node.href !== undefined &&
      (node.tag !== 'a' || !canonicalPath(node.href))
    )
      throw Error('Unsafe semantic link');
    return {
      tag: node.tag as SemanticTag,
      children: node.children.map((child) => parse(child, depth + 1)),
      ...(node.href === undefined ? {} : { href: node.href as string }),
    };
  }
  const snapshot = {
    revision: input.revision,
    path: input.path,
    nodes: input.nodes.map((node) => parse(node, 0)),
  };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 92 * 1024)
    throw Error('Semantic response budget');
  return snapshot;
}
