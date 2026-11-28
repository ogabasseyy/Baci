import ts from '@typescript/typescript6';
import {
  isLexicallyBound,
  resolveLocalConstInit,
} from './component-return-scope';

const NON_ITERABLE_CONSTRUCTORS: ReadonlySet<string> = new Set(
  [
    'Promise|WeakMap|WeakSet|Date|RegExp|Error|TypeError|RangeError',
    'SyntaxError|ReferenceError|URIError|EvalError|Object',
    'URL|Request|Response|Blob|File',
    'ArrayBuffer|SharedArrayBuffer|DataView|AbortController|Event|CustomEvent',
  ]
    .join('|')
    .split('|')
);

const NON_RENDERABLE_GLOBAL_METHODS: ReadonlySet<string> = new Set([
  'Object.create',
  'Object.assign',
  'Object.fromEntries',
  'Promise.resolve',
  'Promise.reject',
  'Promise.all',
  'Promise.race',
  'Promise.any',
  'Promise.allSettled',
  'Promise.withResolvers',
  'Symbol.for',
]);

function unwrapReturnExpr(expr: ts.Expression): ts.Expression {
  let cur = expr;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isTypeAssertionExpression(cur) ||
    ts.isSatisfiesExpression(cur) ||
    ts.isNonNullExpression(cur)
  ) {
    cur = cur.expression;
  }
  if (
    ts.isBinaryExpression(cur) &&
    cur.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    return unwrapReturnExpr(cur.right);
  }
  return cur;
}

function staticTruthiness(
  rawExpr: ts.Expression
): { truthy: boolean; nullish: boolean } | null {
  const e = unwrapReturnExpr(rawExpr);
  if (e.kind === ts.SyntaxKind.TrueKeyword)
    return { truthy: true, nullish: false };
  if (e.kind === ts.SyntaxKind.FalseKeyword)
    return { truthy: false, nullish: false };
  if (e.kind === ts.SyntaxKind.NullKeyword)
    return { truthy: false, nullish: true };
  if (
    ts.isIdentifier(e) &&
    e.text === 'undefined' &&
    !isLexicallyBound(e, 'undefined')
  ) {
    return { truthy: false, nullish: true };
  }
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    return { truthy: e.text.length > 0, nullish: false };
  }
  if (ts.isNumericLiteral(e)) {
    return { truthy: Number(e.text) !== 0, nullish: false };
  }
  if (
    ts.isObjectLiteralExpression(e) ||
    ts.isArrayLiteralExpression(e) ||
    ts.isJsxElement(e) ||
    ts.isJsxSelfClosingElement(e) ||
    ts.isJsxFragment(e)
  ) {
    return { truthy: true, nullish: false };
  }
  return null;
}

export function isStaticallyInvalidReactReturnExpr(
  rawExpr: ts.Expression,
  seen: Set<ts.Node> = new Set()
): boolean {
  const e = unwrapReturnExpr(rawExpr);
  if (seen.has(e)) return false;
  seen.add(e);
  if (
    ts.isObjectLiteralExpression(e) ||
    ts.isRegularExpressionLiteral(e) ||
    ts.isArrowFunction(e) ||
    ts.isFunctionExpression(e) ||
    ts.isClassExpression(e)
  ) {
    return true;
  }
  if (ts.isNewExpression(e)) {
    const ctor = unwrapReturnExpr(e.expression);
    return (
      ts.isIdentifier(ctor) &&
      !isLexicallyBound(ctor, ctor.text) &&
      NON_ITERABLE_CONSTRUCTORS.has(ctor.text)
    );
  }
  if (ts.isIdentifier(e)) {
    const init = resolveLocalConstInit(e);
    return init !== null && isStaticallyInvalidReactReturnExpr(init, seen);
  }
  if (ts.isCallExpression(e)) {
    const callee = unwrapReturnExpr(e.expression);
    if (
      ts.isIdentifier(callee) &&
      callee.text === 'Symbol' &&
      !isLexicallyBound(callee, 'Symbol')
    ) {
      return true;
    }
    return (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      !isLexicallyBound(callee.expression, callee.expression.text) &&
      NON_RENDERABLE_GLOBAL_METHODS.has(
        `${callee.expression.text}.${callee.name.text}`
      )
    );
  }
  if (ts.isArrayLiteralExpression(e)) {
    return e.elements.some(
      (el) =>
        !ts.isOmittedExpression(el) &&
        isStaticallyInvalidReactReturnExpr(
          ts.isSpreadElement(el) ? el.expression : el,
          seen
        )
    );
  }
  if (ts.isConditionalExpression(e)) {
    const st = staticTruthiness(e.condition);
    if (st !== null) {
      return isStaticallyInvalidReactReturnExpr(
        st.truthy ? e.whenTrue : e.whenFalse,
        seen
      );
    }
    return (
      isStaticallyInvalidReactReturnExpr(e.whenTrue, seen) ||
      isStaticallyInvalidReactReturnExpr(e.whenFalse, seen)
    );
  }
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    const st = staticTruthiness(e.left);
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (st !== null && !st.truthy) return false;
      return isStaticallyInvalidReactReturnExpr(e.right, seen);
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      if (st !== null) {
        return isStaticallyInvalidReactReturnExpr(
          st.truthy ? e.left : e.right,
          seen
        );
      }
      return (
        isStaticallyInvalidReactReturnExpr(e.left, seen) ||
        isStaticallyInvalidReactReturnExpr(e.right, seen)
      );
    }
    if (op === ts.SyntaxKind.QuestionQuestionToken) {
      if (st !== null) {
        return isStaticallyInvalidReactReturnExpr(
          st.nullish ? e.right : e.left,
          seen
        );
      }
      return (
        isStaticallyInvalidReactReturnExpr(e.left, seen) ||
        isStaticallyInvalidReactReturnExpr(e.right, seen)
      );
    }
  }
  return false;
}

export function hasNoStaticallyInvalidReactReturn(
  fn: ts.FunctionLikeDeclaration
): boolean {
  if (!fn.body) return true;
  if (!ts.isBlock(fn.body)) return !isStaticallyInvalidReactReturnExpr(fn.body);
  let invalid = false;
  const walk = (n: ts.Node): void => {
    if (invalid) return;
    if (
      n !== fn.body &&
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isGetAccessorDeclaration(n) ||
        ts.isSetAccessorDeclaration(n) ||
        ts.isClassDeclaration(n) ||
        ts.isClassExpression(n))
    ) {
      return;
    }
    if (
      ts.isReturnStatement(n) &&
      n.expression &&
      isStaticallyInvalidReactReturnExpr(n.expression)
    ) {
      invalid = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(fn.body);
  return !invalid;
}
