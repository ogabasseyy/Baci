import ts from '@typescript/typescript6';
import { resolveStaticString } from './const-string-fold';
import {
  bindingDestructuresSubobject,
  MUTABLE_DOM_SUBOBJECT_MEMBERS,
} from './dom-subobject-destructure';
import {
  identifierMutatedWithSubobject,
  parameterReceivesSubobjectFromEnclosingCall,
  resolveLexicalDeclaration,
} from './dom-subobject-mutation-scan';

function collectFunctionReturns(
  fn: ts.FunctionLikeDeclaration
): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const walk = (n: ts.Node): void => {
    if (
      n !== fn.body &&
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n))
    ) {
      return;
    }
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
    ts.forEachChild(n, walk);
  };
  walk(fn.body);
  return out;
}

function unwrapUnmutatedInitializer(
  receiver: ts.Expression,
  check: (sub: ts.Expression) => boolean,
  specificFieldKey?: string
): ts.Expression | null {
  let cur: ts.Expression = receiver;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isSatisfiesExpression(cur)
  ) {
    cur = cur.expression;
  }
  if (ts.isObjectLiteralExpression(cur) || ts.isArrayLiteralExpression(cur)) {
    return cur;
  }
  if (ts.isIdentifier(cur)) {
    const decl = resolveLexicalDeclaration(cur);
    if (
      decl &&
      ts.isVariableDeclaration(decl) &&
      decl.initializer &&
      !identifierMutatedWithSubobject(cur, check, specificFieldKey)
    ) {
      return decl.initializer;
    }
  }
  return null;
}

function resolveObjectLiteralFieldSubobject(
  receiver: ts.Expression,
  fieldKey: string,
  check: (sub: ts.Expression) => boolean
): boolean | null {
  const init = unwrapUnmutatedInitializer(receiver, check, fieldKey);
  if (!init || !ts.isObjectLiteralExpression(init)) return null;
  for (const prop of init.properties) {
    if (ts.isSpreadAssignment(prop)) {
      if (check(prop.expression)) return true;
      continue;
    }
    const k =
      ts.isIdentifier(prop.name) ||
      ts.isStringLiteral(prop.name) ||
      ts.isNumericLiteral(prop.name)
        ? prop.name.text
        : ts.isComputedPropertyName(prop.name)
          ? resolveStaticString(prop.name.expression)
          : null;
    if (k !== null && k !== fieldKey) continue;
    if (ts.isPropertyAssignment(prop) && check(prop.initializer)) return true;
    if (ts.isShorthandPropertyAssignment(prop) && check(prop.name)) return true;
    if (
      (ts.isGetAccessorDeclaration(prop) || ts.isMethodDeclaration(prop)) &&
      collectFunctionReturns(prop).some(check)
    ) {
      return true;
    }
  }
  return false;
}

function resolveTupleIndexSubobject(
  receiver: ts.Expression,
  indexExpr: ts.Expression,
  check: (sub: ts.Expression) => boolean
): boolean | null {
  let arg = indexExpr;
  while (ts.isParenthesizedExpression(arg)) arg = arg.expression;
  if (!ts.isNumericLiteral(arg)) return null;
  const idx = Number(arg.text);
  if (!Number.isSafeInteger(idx) || idx < 0) return null;
  const init = unwrapUnmutatedInitializer(receiver, check, String(idx));
  if (!init || !ts.isArrayLiteralExpression(init)) return null;
  for (let i = 0; i <= idx && i < init.elements.length; i++) {
    if (ts.isSpreadElement(init.elements[i])) return null;
  }
  const el = init.elements[idx];
  if (!el || ts.isOmittedExpression(el)) return false;
  return check(el);
}

function computeSubobjectInChain(
  expr: ts.Expression,
  check: (sub: ts.Expression) => boolean
): boolean {
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr) ||
    ts.isTypeAssertionExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isSpreadElement(expr)
  ) {
    return check(expr.expression);
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.some(
      (el) =>
        !ts.isOmittedExpression(el) &&
        check(ts.isSpreadElement(el) ? el.expression : el)
    );
  }
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.some((prop) => {
      if (ts.isPropertyAssignment(prop)) return check(prop.initializer);
      if (ts.isShorthandPropertyAssignment(prop)) return check(prop.name);
      if (ts.isSpreadAssignment(prop)) return check(prop.expression);
      if (ts.isGetAccessorDeclaration(prop) || ts.isMethodDeclaration(prop)) {
        return collectFunctionReturns(prop).some(check);
      }
      return false;
    });
  }
  if (ts.isConditionalExpression(expr)) {
    return check(expr.whenTrue) || check(expr.whenFalse);
  }
  if (ts.isBinaryExpression(expr)) {
    const k = expr.operatorToken.kind;
    if (
      k >= ts.SyntaxKind.FirstAssignment &&
      k <= ts.SyntaxKind.LastAssignment
    ) {
      return check(expr.right);
    }
    if (k === ts.SyntaxKind.CommaToken) return check(expr.right);
    if (
      k === ts.SyntaxKind.AmpersandAmpersandToken ||
      k === ts.SyntaxKind.BarBarToken ||
      k === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return check(expr.left) || check(expr.right);
    }
    return false;
  }
  if (ts.isNewExpression(expr)) {
    return (expr.arguments ?? []).some((a) =>
      check(ts.isSpreadElement(a) ? a.expression : a)
    );
  }
  if (ts.isPropertyAccessExpression(expr)) {
    if (MUTABLE_DOM_SUBOBJECT_MEMBERS.has(expr.name.text)) return true;
    const f = resolveObjectLiteralFieldSubobject(
      expr.expression,
      expr.name.text,
      check
    );
    return f !== null ? f : check(expr.expression);
  }
  if (ts.isElementAccessExpression(expr)) {
    const tupleRes = resolveTupleIndexSubobject(
      expr.expression,
      expr.argumentExpression,
      check
    );
    if (tupleRes !== null) return tupleRes;
    const key = resolveStaticString(expr.argumentExpression);
    if (key !== null) {
      if (MUTABLE_DOM_SUBOBJECT_MEMBERS.has(key)) return true;
      const f = resolveObjectLiteralFieldSubobject(expr.expression, key, check);
      if (f !== null) return f;
    }
    return check(expr.expression);
  }
  if (ts.isCallExpression(expr)) {
    if (expr.arguments.some(check)) return true;
    if (
      ts.isPropertyAccessExpression(expr.expression) ||
      ts.isElementAccessExpression(expr.expression)
    ) {
      return check(expr.expression.expression);
    }
    if (ts.isIdentifier(expr.expression)) {
      const decl = resolveLexicalDeclaration(expr.expression);
      if (decl && ts.isFunctionDeclaration(decl)) {
        return collectFunctionReturns(decl).some(check);
      }
      if (
        decl &&
        ts.isVariableDeclaration(decl) &&
        decl.initializer &&
        (ts.isArrowFunction(decl.initializer) ||
          ts.isFunctionExpression(decl.initializer))
      ) {
        return collectFunctionReturns(decl.initializer).some(check);
      }
    }
    return false;
  }
  if (ts.isIdentifier(expr)) {
    const decl = resolveLexicalDeclaration(expr);
    if (decl && ts.isVariableDeclaration(decl)) {
      const parentList = decl.parent;
      if (
        ts.isVariableDeclarationList(parentList) &&
        ts.isForOfStatement(parentList.parent) &&
        parentList.parent.initializer === parentList &&
        check(parentList.parent.expression)
      ) {
        return (
          (ts.isIdentifier(decl.name) && decl.name.text === expr.text) ||
          bindingDestructuresSubobject(decl.name, expr.text, true)
        );
      }
      const initSub = Boolean(decl.initializer && check(decl.initializer));
      if (
        (ts.isIdentifier(decl.name) &&
          decl.name.text === expr.text &&
          initSub) ||
        bindingDestructuresSubobject(decl.name, expr.text, initSub)
      ) {
        return true;
      }
    } else if (
      decl &&
      ts.isParameter(decl) &&
      (ts.isFunctionDeclaration(decl.parent) ||
        ts.isFunctionExpression(decl.parent) ||
        ts.isArrowFunction(decl.parent) ||
        ts.isMethodDeclaration(decl.parent) ||
        ts.isSetAccessorDeclaration(decl.parent) ||
        ts.isConstructorDeclaration(decl.parent))
    ) {
      const fn = decl.parent;
      const idx = fn.parameters.indexOf(decl);
      if (
        idx >= 0 &&
        (bindingDestructuresSubobject(decl.name, expr.text, false) ||
          parameterReceivesSubobjectFromEnclosingCall(
            fn,
            idx,
            expr.text,
            check
          ))
      ) {
        return true;
      }
    }
    return identifierMutatedWithSubobject(expr, check);
  }
  return false;
}

export function hasMutableDomSubobjectInChain(
  expr: ts.Expression,
  memo: Map<ts.Node, boolean> = new Map()
): boolean {
  const existing = memo.get(expr);
  if (existing !== undefined) return existing;
  memo.set(expr, false);
  const res = computeSubobjectInChain(expr, (sub) =>
    hasMutableDomSubobjectInChain(sub, memo)
  );
  memo.set(expr, res);
  return res;
}
