import { finalDeclarationsForStyle } from './review-handoff-style-declarations';

/**
 * Collect the custom properties an element inherits from its
 * ancestors. The browser resolves a child's `var()` against the
 * nearest ancestor declaration, so gather root-first with the
 * closest ancestor winning; the element's own block overrides the
 * merge at evaluation time.
 */
export function inheritedCustomProperties(
  element: Element
): Map<string, string> {
  const chain: Element[] = [];
  let node = element.parentElement;
  while (node !== null) {
    chain.unshift(node);
    node = node.parentElement;
  }
  const customs = new Map<string, string>();
  for (const ancestor of chain) {
    const style = ancestor.getAttribute('style');
    if (style === null) continue;
    for (const [name, entry] of finalDeclarationsForStyle(style)) {
      if (name.startsWith('--')) customs.set(name, entry.value);
    }
  }
  return customs;
}
