import ts from '@typescript/typescript6';
import { resolveStaticString } from './const-string-fold';
import { hasLocalLexicalBinding } from './jsx-tag-safety';
import {
  findLexicalConstDeclaration,
  hasInnerShadowing,
} from './lexical-const-lookup';

export type BrowserGlobalName = 'document' | 'window' | 'navigator';

const BROWSER_GLOBAL_SET: ReadonlySet<string> = new Set([
  'document',
  'window',
  'navigator',
]);

export function isBrowserGlobalName(name: string): name is BrowserGlobalName {
  return BROWSER_GLOBAL_SET.has(name);
}

function isUnshadowedGlobalHostId(id: ts.Identifier): boolean {
  return (
    (id.text === 'globalThis' || id.text === 'self') &&
    !hasLocalLexicalBinding(id, id.text) &&
    !hasInnerShadowing(id, id.text)
  );
}

export function isSsrGlobalHostReceiver(
  expr: ts.Expression,
  seen: Set<ts.Node> = new Set()
): boolean {
  if (seen.has(expr)) return false;
  seen.add(expr);
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr) ||
    ts.isSatisfiesExpression(expr)
  ) {
    return isSsrGlobalHostReceiver(expr.expression, seen);
  }
  if (ts.isIdentifier(expr)) {
    if (
      (expr.text === 'globalThis' ||
        expr.text === 'self' ||
        expr.text === 'window') &&
      !hasLocalLexicalBinding(expr, expr.text) &&
      !hasInnerShadowing(expr, expr.text)
    ) {
      return true;
    }
    const found = findLexicalConstDeclaration(expr, expr.text);
    return Boolean(
      found &&
        !found.bindingEl &&
        found.decl.initializer &&
        isSsrGlobalHostReceiver(found.decl.initializer, seen)
    );
  }
  if (
    (ts.isPropertyAccessExpression(expr) ||
      ts.isElementAccessExpression(expr)) &&
    isSsrGlobalHostReceiver(expr.expression, seen)
  ) {
    const k = ts.isPropertyAccessExpression(expr)
      ? expr.name.text
      : resolveStaticString(expr.argumentExpression);
    return k === 'globalThis' || k === 'self' || k === 'window';
  }
  return false;
}

function isSafeWorkerdOptionalRootChain(expr: ts.Expression): boolean {
  let cur: ts.Expression = expr;
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
  if (ts.isIdentifier(cur)) return isUnshadowedGlobalHostId(cur);
  if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
    const k = ts.isPropertyAccessExpression(cur)
      ? cur.name.text
      : resolveStaticString(cur.argumentExpression);
    if (k === 'globalThis' || k === 'self') {
      return isSafeWorkerdOptionalRootChain(cur.expression);
    }
    if (k === 'window' || k === 'document' || k === 'navigator') {
      return (
        Boolean(cur.questionDotToken) &&
        isSafeWorkerdOptionalRootChain(cur.expression)
      );
    }
  }
  return false;
}

export function isOptionalChainedWorkerdGlobalRead(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression
): boolean {
  let recv: ts.Expression = node.expression;
  while (ts.isParenthesizedExpression(recv)) recv = recv.expression;
  const recvSafe = ts.isIdentifier(recv)
    ? isUnshadowedGlobalHostId(recv)
    : (ts.isPropertyAccessExpression(recv) ||
        ts.isElementAccessExpression(recv)) &&
      Boolean(node.questionDotToken) &&
      isSafeWorkerdOptionalRootChain(recv);
  if (!recvSafe) return false;
  let wrapped: ts.Node = node;
  while (wrapped.parent && ts.isParenthesizedExpression(wrapped.parent)) {
    wrapped = wrapped.parent;
  }
  const p = wrapped.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.expression === wrapped) {
    return Boolean(p.questionDotToken);
  }
  if (ts.isElementAccessExpression(p) && p.expression === wrapped) {
    return Boolean(p.questionDotToken);
  }
  return false;
}

function isUndefinedLiteralString(expr: ts.Expression): boolean {
  let cur: ts.Expression = expr;
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
  if (resolveStaticString(cur) === 'undefined') return true;
  if (ts.isIdentifier(cur)) {
    const found = findLexicalConstDeclaration(cur, cur.text);
    if (
      found &&
      !found.bindingEl &&
      found.decl.initializer &&
      resolveStaticString(found.decl.initializer) === 'undefined'
    ) {
      return true;
    }
  }
  return false;
}

function isTypeofTargetGlobal(
  expr: ts.Expression,
  target: BrowserGlobalName
): boolean {
  let cur: ts.Expression = expr;
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
  if (!ts.isTypeOfExpression(cur)) return false;
  let op: ts.Expression = cur.expression;
  while (ts.isParenthesizedExpression(op)) op = op.expression;
  if (ts.isIdentifier(op)) {
    return (
      op.text === target &&
      !hasLocalLexicalBinding(op, target) &&
      !hasInnerShadowing(op, target)
    );
  }
  const memberKey = ts.isPropertyAccessExpression(op)
    ? op.name.text
    : ts.isElementAccessExpression(op)
      ? resolveStaticString(op.argumentExpression)
      : null;
  if (
    memberKey === target &&
    (ts.isPropertyAccessExpression(op) || ts.isElementAccessExpression(op))
  ) {
    let hostExpr: ts.Expression = op.expression;
    while (ts.isParenthesizedExpression(hostExpr)) {
      hostExpr = hostExpr.expression;
    }
    return ts.isIdentifier(hostExpr) && isUnshadowedGlobalHostId(hostExpr);
  }
  return false;
}

export function guaranteesDefinedWhenTruthy(
  expr: ts.Expression,
  target: BrowserGlobalName
): boolean {
  let cur: ts.Expression = expr;
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
  if (
    ts.isPrefixUnaryExpression(cur) &&
    cur.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return guaranteesDefinedWhenFalsy(cur.operand, target);
  }
  if (!ts.isBinaryExpression(cur)) return false;
  const k = cur.operatorToken.kind;
  if (
    k === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    k === ts.SyntaxKind.ExclamationEqualsToken
  ) {
    return (
      (isTypeofTargetGlobal(cur.left, target) &&
        isUndefinedLiteralString(cur.right)) ||
      (isTypeofTargetGlobal(cur.right, target) &&
        isUndefinedLiteralString(cur.left))
    );
  }
  if (k === ts.SyntaxKind.AmpersandAmpersandToken) {
    return (
      guaranteesDefinedWhenTruthy(cur.left, target) ||
      guaranteesDefinedWhenTruthy(cur.right, target)
    );
  }
  return (
    k === ts.SyntaxKind.BarBarToken &&
    guaranteesDefinedWhenTruthy(cur.left, target) &&
    guaranteesDefinedWhenTruthy(cur.right, target)
  );
}

export function guaranteesDefinedWhenFalsy(
  expr: ts.Expression,
  target: BrowserGlobalName
): boolean {
  let cur: ts.Expression = expr;
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
  if (
    ts.isPrefixUnaryExpression(cur) &&
    cur.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return guaranteesDefinedWhenTruthy(cur.operand, target);
  }
  if (!ts.isBinaryExpression(cur)) return false;
  const k = cur.operatorToken.kind;
  if (
    k === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    k === ts.SyntaxKind.EqualsEqualsToken
  ) {
    return (
      (isTypeofTargetGlobal(cur.left, target) &&
        isUndefinedLiteralString(cur.right)) ||
      (isTypeofTargetGlobal(cur.right, target) &&
        isUndefinedLiteralString(cur.left))
    );
  }
  if (k === ts.SyntaxKind.BarBarToken) {
    return (
      guaranteesDefinedWhenFalsy(cur.left, target) ||
      guaranteesDefinedWhenFalsy(cur.right, target)
    );
  }
  return (
    k === ts.SyntaxKind.AmpersandAmpersandToken &&
    guaranteesDefinedWhenFalsy(cur.left, target) &&
    guaranteesDefinedWhenFalsy(cur.right, target)
  );
}
