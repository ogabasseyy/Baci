import ts from '@typescript/typescript6';
import { resolveLexicalBinding } from './analytics-delivery-lexical-binding';

function unwrap(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
    ? unwrap(expression.expression)
    : expression;
}

function bindingIsConst(binding: ts.VariableDeclaration): boolean {
  return Boolean(ts.getCombinedNodeFlags(binding.parent) & ts.NodeFlags.Const);
}

function bindingIsWritten(
  file: ts.SourceFile,
  binding: ts.VariableDeclaration,
  at: ts.Node
): boolean {
  let written = false;
  function visit(node: ts.Node) {
    if (
      ts.isBinaryExpression(node) &&
      node.pos < at.pos &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ts.isIdentifier(node.left) &&
      resolveLexicalBinding(file, node.left, node) === binding
    ) {
      written = true;
    }
    if (!written) ts.forEachChild(node, visit);
  }
  visit(file);
  return written;
}

export function resolveLexicalString(
  expression: ts.Expression | undefined,
  file: ts.SourceFile,
  at: ts.Node,
  seen = new Set<number>()
): string | undefined {
  if (!expression) return undefined;
  const value = unwrap(expression);
  if (ts.isStringLiteralLike(value)) return value.text;
  if (
    ts.isBinaryExpression(value) &&
    value.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = resolveLexicalString(value.left, file, at, new Set(seen));
    const right = resolveLexicalString(value.right, file, at, new Set(seen));
    return left !== undefined && right !== undefined
      ? `${left}${right}`
      : undefined;
  }
  if (!ts.isIdentifier(value)) return undefined;
  const binding = resolveLexicalBinding(file, value, at);
  if (
    !binding ||
    ts.isParameter(binding) ||
    !bindingIsConst(binding) ||
    bindingIsWritten(file, binding, at) ||
    seen.has(binding.pos)
  ) {
    return undefined;
  }
  const nextSeen = new Set(seen);
  nextSeen.add(binding.pos);
  return resolveLexicalString(binding.initializer, file, binding, nextSeen);
}
