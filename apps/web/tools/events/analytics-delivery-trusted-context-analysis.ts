import ts from '@typescript/typescript6';
import { resolveLexicalBinding } from './analytics-delivery-lexical-binding';

function assignmentTarget(node: ts.Node): ts.Expression | undefined {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return node.left;
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(
      node.operator
    )
  ) {
    return node.operand;
  }
}

export function trustedContextIsSafe(
  file: ts.SourceFile,
  identifier: ts.Identifier
): boolean {
  const root = resolveLexicalBinding(file, identifier, identifier);
  if (!root || ts.isParameter(root)) return false;
  const aliases = new Set<ts.VariableDeclaration | ts.ParameterDeclaration>([
    root,
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    function collect(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer)
      ) {
        const source = resolveLexicalBinding(file, node.initializer, node);
        if (source && aliases.has(source) && !aliases.has(node)) {
          aliases.add(node);
          changed = true;
        }
      }
      ts.forEachChild(node, collect);
    }
    collect(file);
  }
  const properties =
    identifier.text === 'context'
      ? new Set(['merchantId', 'verified'])
      : new Set(['verifiedMerchantId']);
  const tracked = (node: ts.Expression | undefined, at: ts.Node) => {
    if (!node || !ts.isIdentifier(node)) return false;
    const binding = resolveLexicalBinding(file, node, at);
    return Boolean(binding && aliases.has(binding));
  };
  let unsafe = false;
  function visit(node: ts.Node) {
    const target = assignmentTarget(node);
    if (
      target &&
      (ts.isPropertyAccessExpression(target) ||
        ts.isElementAccessExpression(target)) &&
      tracked(target.expression, node)
    ) {
      const property = ts.isPropertyAccessExpression(target)
        ? target.name.text
        : target.argumentExpression &&
            ts.isStringLiteralLike(target.argumentExpression)
          ? target.argumentExpression.text
          : undefined;
      if (!property || properties.has(property)) unsafe = true;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      ((node.expression.expression.text === 'Object' &&
        ['assign', 'defineProperty'].includes(node.expression.name.text)) ||
        (node.expression.expression.text === 'Reflect' &&
          node.expression.name.text === 'set')) &&
      tracked(node.arguments[0], node)
    ) {
      unsafe = true;
    }
    if (ts.isIdentifier(node) && tracked(node, node)) {
      const parent = node.parent;
      const safe =
        (ts.isVariableDeclaration(parent) &&
          (parent.name === node || parent.initializer === node)) ||
        ((ts.isPropertyAccessExpression(parent) ||
          ts.isElementAccessExpression(parent)) &&
          parent.expression === node);
      if (!safe) unsafe = true;
    }
    if (!unsafe) ts.forEachChild(node, visit);
  }
  visit(file);
  return !unsafe;
}
