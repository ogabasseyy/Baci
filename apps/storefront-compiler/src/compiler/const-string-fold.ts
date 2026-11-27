import ts from '@typescript/typescript6';
import { bindingContainsName, hasDeclareModifier } from './jsx-export-graph';
import { resolveStaticString } from './source-guard-ast';

export function resolveStaticOrConstString(
  expr: ts.Expression,
  depth = 0
): string | null {
  if (depth > 8) return null;
  const direct = resolveStaticString(expr);
  if (direct !== null) return direct;
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    return resolveStaticOrConstString(expr.expression, depth + 1);
  }
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const l = resolveStaticOrConstString(expr.left, depth + 1);
    const r = resolveStaticOrConstString(expr.right, depth + 1);
    return l !== null && r !== null ? l + r : null;
  }
  if (ts.isTemplateExpression(expr)) {
    let acc = expr.head.text;
    for (const span of expr.templateSpans) {
      const mid = resolveStaticOrConstString(span.expression, depth + 1);
      if (mid === null) return null;
      acc += mid + span.literal.text;
    }
    return acc;
  }
  if (!ts.isIdentifier(expr)) return null;
  const target = expr.text;
  for (let cur: ts.Node | undefined = expr.parent; cur; cur = cur.parent) {
    if (
      ts.isCatchClause(cur) &&
      cur.variableDeclaration &&
      bindingContainsName(cur.variableDeclaration.name, target)
    ) {
      return null;
    }
    if (
      (ts.isForStatement(cur) ||
        ts.isForInStatement(cur) ||
        ts.isForOfStatement(cur)) &&
      cur.initializer &&
      ts.isVariableDeclarationList(cur.initializer) &&
      cur.initializer.declarations.some((d) =>
        bindingContainsName(d.name, target)
      )
    ) {
      return null;
    }
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isSetAccessorDeclaration(cur) ||
      ts.isConstructorDeclaration(cur)
    ) {
      if (cur.parameters.some((p) => bindingContainsName(p.name, target))) {
        return null;
      }
      if (ts.isFunctionExpression(cur) && cur.name?.text === target) {
        return null;
      }
    }
    const scopeStmts = ts.isCaseBlock(cur)
      ? cur.clauses.flatMap((c) => c.statements)
      : ts.isBlock(cur) || ts.isSourceFile(cur)
        ? cur.statements
        : null;
    if (scopeStmts) {
      for (const stmt of scopeStmts) {
        if (hasDeclareModifier(stmt)) continue;
        if (ts.isVariableStatement(stmt)) {
          const isConst =
            (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
          for (const d of stmt.declarationList.declarations) {
            if (bindingContainsName(d.name, target)) {
              return isConst &&
                ts.isIdentifier(d.name) &&
                d.initializer !== undefined
                ? resolveStaticOrConstString(d.initializer, depth + 1)
                : null;
            }
          }
        } else if (
          (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
          stmt.name?.text === target
        ) {
          return null;
        }
      }
    }
  }
  return null;
}
