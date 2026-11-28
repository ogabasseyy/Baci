import ts from '@typescript/typescript6';
import { collectReassignedIdentifiers } from './dom-mutation-guard';
import { resolveLexicalDeclaration } from './dom-subobject-destructure';

function unwrapExpr(expr: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr)
  ) {
    return unwrapExpr(expr.expression);
  }
  return expr;
}

function isSyncCallableFunctionNode(fn: ts.FunctionLikeDeclaration): boolean {
  if (fn.asteriskToken) return false;
  return !(
    ts.canHaveModifiers(fn) &&
    ts.getModifiers(fn)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  );
}

export function isValidMemoComparatorArg(
  expr: ts.Expression,
  isShadowed?: (atNode: ts.Node, ident: string) => boolean,
  seen: Set<ts.Node> = new Set(),
  reassigned?: ReadonlySet<string>
): boolean {
  if (seen.has(expr)) return false;
  seen.add(expr);
  const inner = unwrapExpr(expr);
  if (ts.isVoidExpression(inner)) return true;
  if (
    (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) &&
    isSyncCallableFunctionNode(inner)
  ) {
    return true;
  }
  if (ts.isIdentifier(inner)) {
    const mutated =
      reassigned ?? collectReassignedIdentifiers(inner.getSourceFile());
    if (
      inner.text === 'undefined' &&
      !isShadowed?.(inner, 'undefined') &&
      resolveLexicalDeclaration(inner) === null
    ) {
      return true;
    }
    if (mutated.has(inner.text)) return false;
    const decl = resolveLexicalDeclaration(inner);
    if (
      decl &&
      ts.isFunctionDeclaration(decl) &&
      decl.body &&
      decl.name &&
      !mutated.has(decl.name.text)
    ) {
      return isSyncCallableFunctionNode(decl);
    }
    if (
      decl &&
      ts.isVariableDeclaration(decl) &&
      ts.isIdentifier(decl.name) &&
      !mutated.has(decl.name.text) &&
      decl.initializer &&
      ts.isVariableDeclarationList(decl.parent) &&
      (decl.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      return isValidMemoComparatorArg(
        decl.initializer,
        isShadowed,
        seen,
        mutated
      );
    }
  }
  return false;
}
