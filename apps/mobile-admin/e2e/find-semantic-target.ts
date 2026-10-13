import type { SemanticNode, SemanticTarget } from './semantic-types';

function isDisabled(node: SemanticNode): boolean {
  return node.enabled === false || node.accessibilityState?.disabled === true;
}

/**
 * Resolves one exact target from a runner-provided accessibility tree.
 * Partial labels are intentionally rejected because they make a flow pass
 * against the wrong control after a copy change.
 */
export function findSemanticTarget(
  nodes: readonly SemanticNode[],
  target: SemanticTarget
): SemanticNode {
  const matches = nodes.filter(
    (node) =>
      node.accessibilityLabel === target.label &&
      (target.role === undefined || node.accessibilityRole === target.role)
  );
  const match = matches[0];

  if (!match) {
    const role = target.role === undefined ? '' : ` with role "${target.role}"`;
    throw new Error(
      `Semantic target "${target.label}"${role} was not found in the accessibility tree`
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Semantic target "${target.label}" matched ${matches.length} nodes in the accessibility tree`
    );
  }

  if (isDisabled(match)) {
    throw new Error(`Semantic target "${target.label}" is disabled`);
  }

  return match;
}
