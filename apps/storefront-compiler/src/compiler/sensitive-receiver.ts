import ts from '@typescript/typescript6';
import { SENSITIVE_GLOBAL_ROOTS } from './banned-specifiers';
import { resolveStaticString } from './const-string-fold';
import { hasLocalLexicalBinding } from './jsx-tag-safety';

function findLocalVariableInitializer(
  id: ts.Identifier
): ts.Expression | undefined {
  let cur: ts.Node | undefined = id.parent;
  while (cur) {
    if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
      for (const stmt of cur.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === id.text) {
            return decl.initializer;
          }
        }
      }
    }
    cur = cur.parent;
  }
  return undefined;
}

export function isDocumentReceiver(
  expr: ts.Expression,
  seen: Set<ts.Node> = new Set()
): boolean {
  if (seen.has(expr)) return false;
  seen.add(expr);
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    return isDocumentReceiver(expr.expression, seen);
  }
  if (ts.isIdentifier(expr)) {
    if (expr.text === 'document' && !hasLocalLexicalBinding(expr, 'document')) {
      return true;
    }
    const init = findLocalVariableInitializer(expr);
    return init !== undefined && isDocumentReceiver(init, seen);
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return (
      expr.name.text === 'document' &&
      isSensitiveGlobalReceiver(expr.expression)
    );
  }
  if (ts.isElementAccessExpression(expr)) {
    return (
      resolveStaticString(expr.argumentExpression) === 'document' &&
      isSensitiveGlobalReceiver(expr.expression)
    );
  }
  return false;
}

export function isNavigatorReceiver(
  expr: ts.Expression,
  seen: Set<ts.Node> = new Set()
): boolean {
  if (seen.has(expr)) return false;
  seen.add(expr);
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    return isNavigatorReceiver(expr.expression, seen);
  }
  if (ts.isIdentifier(expr)) {
    if (
      expr.text === 'navigator' &&
      !hasLocalLexicalBinding(expr, 'navigator')
    ) {
      return true;
    }
    const init = findLocalVariableInitializer(expr);
    return init !== undefined && isNavigatorReceiver(init, seen);
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return (
      expr.name.text === 'navigator' &&
      isSensitiveGlobalReceiver(expr.expression)
    );
  }
  if (ts.isElementAccessExpression(expr)) {
    return (
      resolveStaticString(expr.argumentExpression) === 'navigator' &&
      isSensitiveGlobalReceiver(expr.expression)
    );
  }
  return false;
}

export function isSensitiveGlobalReceiver(
  expr: ts.Expression,
  seen: Set<ts.Node> = new Set()
): boolean {
  if (seen.has(expr)) return false;
  seen.add(expr);
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    return isSensitiveGlobalReceiver(expr.expression, seen);
  }
  if (ts.isIdentifier(expr)) {
    if (
      SENSITIVE_GLOBAL_ROOTS.has(expr.text) &&
      !hasLocalLexicalBinding(expr, expr.text)
    ) {
      return true;
    }
    const init = findLocalVariableInitializer(expr);
    return init !== undefined && isSensitiveGlobalReceiver(init, seen);
  }
  if (
    ts.isCallExpression(expr) &&
    (ts.isPropertyAccessExpression(expr.expression) ||
      ts.isElementAccessExpression(expr.expression))
  ) {
    return isSensitiveGlobalReceiver(expr.expression.expression, seen);
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return (
      SENSITIVE_GLOBAL_ROOTS.has(expr.name.text) ||
      isSensitiveGlobalReceiver(expr.expression, seen)
    );
  }
  if (ts.isElementAccessExpression(expr)) {
    const k = resolveStaticString(expr.argumentExpression);
    return (
      (k !== null && SENSITIVE_GLOBAL_ROOTS.has(k)) ||
      isSensitiveGlobalReceiver(expr.expression, seen)
    );
  }
  return false;
}
