import ts from '@typescript/typescript6';
import { FORBIDDEN_DOM_MUTATION_MEMBERS } from './banned-specifiers';
import { resolveStaticString } from './const-string-fold';

function isWriteTargetExpression(node: ts.Node): boolean {
  let cur: ts.Node = node;
  while (cur.parent) {
    const p = cur.parent;
    if (
      ts.isBinaryExpression(p) &&
      p.left === cur &&
      p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      p.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      return true;
    }
    if (
      (ts.isForInStatement(p) || ts.isForOfStatement(p)) &&
      p.initializer === cur
    ) {
      return true;
    }
    if (ts.isDeleteExpression(p) && p.expression === cur) return true;
    if (
      (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
      (p.operator === ts.SyntaxKind.PlusPlusToken ||
        p.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      return true;
    }
    if (
      ts.isParenthesizedExpression(p) ||
      ts.isAsExpression(p) ||
      ts.isNonNullExpression(p) ||
      ts.isTypeAssertionExpression(p) ||
      ts.isSatisfiesExpression(p) ||
      ts.isArrayLiteralExpression(p) ||
      ts.isObjectLiteralExpression(p) ||
      ts.isSpreadAssignment(p) ||
      (ts.isPropertyAssignment(p) && p.initializer === cur)
    ) {
      cur = p;
      continue;
    }
    return false;
  }
  return false;
}

function hasStyleMemberInReceiverChain(expr: ts.Expression): boolean {
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    return hasStyleMemberInReceiverChain(expr.expression);
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return (
      expr.name.text === 'style' ||
      hasStyleMemberInReceiverChain(expr.expression)
    );
  }
  if (ts.isElementAccessExpression(expr)) {
    return (
      resolveStaticString(expr.argumentExpression) === 'style' ||
      hasStyleMemberInReceiverChain(expr.expression)
    );
  }
  return false;
}

export function isForbiddenDomPropertyMutation(
  memberName: string,
  receiver?: ts.Expression,
  memberAccessNode?: ts.Node
): boolean {
  if (!memberAccessNode || !isWriteTargetExpression(memberAccessNode)) {
    return false;
  }
  return (
    FORBIDDEN_DOM_MUTATION_MEMBERS.has(memberName) ||
    (receiver !== undefined && hasStyleMemberInReceiverChain(receiver))
  );
}
