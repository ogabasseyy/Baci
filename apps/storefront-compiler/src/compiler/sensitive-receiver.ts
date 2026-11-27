import ts from '@typescript/typescript6';
import { SENSITIVE_GLOBAL_ROOTS } from './banned-specifiers';
import { resolveStaticString } from './const-string-fold';
import { hasLocalLexicalBinding } from './jsx-tag-safety';

const WINDOW_YIELDING_MEMBER_NAMES: ReadonlySet<string> = new Set([
  'view',
  'source',
]);

function isDestructuredSensitiveMember(
  pattern: ts.ObjectBindingPattern,
  targetName: string
): boolean {
  for (const el of pattern.elements) {
    if (ts.isIdentifier(el.name) && el.name.text === targetName) {
      const prop = el.propertyName
        ? ts.isIdentifier(el.propertyName) ||
          ts.isStringLiteral(el.propertyName)
          ? el.propertyName.text
          : ts.isComputedPropertyName(el.propertyName)
            ? resolveStaticString(el.propertyName.expression)
            : null
        : el.name.text;
      if (
        prop !== null &&
        (SENSITIVE_GLOBAL_ROOTS.has(prop) ||
          WINDOW_YIELDING_MEMBER_NAMES.has(prop))
      ) {
        return true;
      }
    } else if (
      ts.isObjectBindingPattern(el.name) &&
      isDestructuredSensitiveMember(el.name, targetName)
    ) {
      return true;
    }
  }
  return false;
}

function findLocalBindingSource(id: ts.Identifier): {
  initializer?: ts.Expression;
  isSensitiveDestructure: boolean;
} {
  let cur: ts.Node | undefined = id.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      for (const param of cur.parameters) {
        if (
          ts.isObjectBindingPattern(param.name) &&
          isDestructuredSensitiveMember(param.name, id.text)
        ) {
          return { isSensitiveDestructure: true };
        }
      }
    }
    if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
      for (const stmt of cur.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === id.text) {
            return {
              initializer: decl.initializer,
              isSensitiveDestructure: false,
            };
          }
          if (
            ts.isObjectBindingPattern(decl.name) &&
            isDestructuredSensitiveMember(decl.name, id.text)
          ) {
            return { isSensitiveDestructure: true };
          }
        }
      }
    }
    cur = cur.parent;
  }
  return { isSensitiveDestructure: false };
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
    const src = findLocalBindingSource(expr);
    return (
      src.initializer !== undefined && isDocumentReceiver(src.initializer, seen)
    );
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
    const src = findLocalBindingSource(expr);
    return (
      src.initializer !== undefined &&
      isNavigatorReceiver(src.initializer, seen)
    );
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
    const src = findLocalBindingSource(expr);
    if (src.isSensitiveDestructure) return true;
    return (
      src.initializer !== undefined &&
      isSensitiveGlobalReceiver(src.initializer, seen)
    );
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
      WINDOW_YIELDING_MEMBER_NAMES.has(expr.name.text) ||
      isSensitiveGlobalReceiver(expr.expression, seen)
    );
  }
  if (ts.isElementAccessExpression(expr)) {
    const k = resolveStaticString(expr.argumentExpression);
    return (
      (k !== null &&
        (SENSITIVE_GLOBAL_ROOTS.has(k) ||
          WINDOW_YIELDING_MEMBER_NAMES.has(k))) ||
      isSensitiveGlobalReceiver(expr.expression, seen)
    );
  }
  return false;
}
