import ts from '@typescript/typescript6';
import { resolveStaticString } from './const-string-fold';
import {
  assignmentDestructuresSubobject,
  bindingDestructuresSubobject,
  resolveLexicalDeclaration,
} from './dom-subobject-destructure';

export { resolveLexicalDeclaration };

const CONTAINER_MUTATOR_METHODS: ReadonlySet<string> = new Set([
  'push',
  'unshift',
  'splice',
  'fill',
  'copyWithin',
  'set',
  'add',
]);

export function unwrapRootIdentifier(
  expr: ts.Expression
): ts.Identifier | null {
  let cur: ts.Expression = expr;
  while (true) {
    if (
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isTypeAssertionExpression(cur) ||
      ts.isSatisfiesExpression(cur) ||
      ts.isPropertyAccessExpression(cur) ||
      ts.isElementAccessExpression(cur)
    ) {
      cur = cur.expression;
      continue;
    }
    return ts.isIdentifier(cur) ? cur : null;
  }
}

export function parameterReceivesSubobjectFromEnclosingCall(
  fn: ts.FunctionLikeDeclaration,
  paramIndex: number,
  targetName: string,
  checkSubobject: (expr: ts.Expression) => boolean
): boolean {
  const param = fn.parameters[paramIndex];
  if (!param) return false;
  const bindsTarget =
    (ts.isIdentifier(param.name) && param.name.text === targetName) ||
    bindingDestructuresSubobject(param.name, targetName, true);
  if (!bindsTarget) return false;

  let fnExpr: ts.Node = fn;
  while (
    fnExpr.parent &&
    (ts.isParenthesizedExpression(fnExpr.parent) ||
      ts.isAsExpression(fnExpr.parent) ||
      ts.isSatisfiesExpression(fnExpr.parent))
  ) {
    fnExpr = fnExpr.parent;
  }
  const call = fnExpr.parent;
  if (!call || !ts.isCallExpression(call)) return false;

  let callee: ts.Expression = call.expression;
  while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
  if (call.expression === fnExpr || callee === fnExpr) {
    const arg = call.arguments[paramIndex];
    return (
      arg !== undefined &&
      checkSubobject(ts.isSpreadElement(arg) ? arg.expression : arg)
    );
  }
  if (
    (ts.isPropertyAccessExpression(callee) ||
      ts.isElementAccessExpression(callee)) &&
    call.arguments.some((a) => a === fnExpr)
  ) {
    const methodName = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : resolveStaticString(callee.argumentExpression);
    if (methodName === 'reduce' || methodName === 'reduceRight') {
      if (paramIndex === 0) {
        const init = call.arguments[1];
        return init !== undefined
          ? checkSubobject(ts.isSpreadElement(init) ? init.expression : init)
          : checkSubobject(callee.expression);
      }
      return paramIndex === 1 && checkSubobject(callee.expression);
    }
    if (paramIndex === 0 && checkSubobject(callee.expression)) return true;
    const firstArg = call.arguments[0];
    if (
      paramIndex === 0 &&
      firstArg &&
      firstArg !== fnExpr &&
      checkSubobject(
        ts.isSpreadElement(firstArg) ? firstArg.expression : firstArg
      )
    ) {
      return true;
    }
  }
  return false;
}

function extractAssignedRootAndFirstKey(lhs: ts.Expression): {
  root: ts.Identifier | null;
  firstKey: string | null;
  isWholeRoot: boolean;
} {
  let cur: ts.Expression = lhs;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isSatisfiesExpression(cur)
  ) {
    cur = cur.expression;
  }
  if (ts.isIdentifier(cur)) {
    return { root: cur, firstKey: null, isWholeRoot: true };
  }
  const chain: Array<ts.PropertyAccessExpression | ts.ElementAccessExpression> =
    [];
  while (
    ts.isPropertyAccessExpression(cur) ||
    ts.isElementAccessExpression(cur)
  ) {
    chain.push(cur);
    cur = cur.expression;
    while (
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isSatisfiesExpression(cur)
    ) {
      cur = cur.expression;
    }
  }
  if (!ts.isIdentifier(cur) || chain.length === 0) {
    return { root: null, firstKey: null, isWholeRoot: false };
  }
  const top = chain[chain.length - 1];
  const firstKey = ts.isPropertyAccessExpression(top)
    ? top.name.text
    : ts.isNumericLiteral(top.argumentExpression)
      ? top.argumentExpression.text
      : resolveStaticString(top.argumentExpression);
  return { root: cur, firstKey, isWholeRoot: false };
}

export function identifierMutatedWithSubobject(
  targetId: ts.Identifier,
  checkSubobject: (expr: ts.Expression) => boolean,
  specificFieldKey?: string
): boolean {
  const sf = targetId.getSourceFile();
  const targetDecl = resolveLexicalDeclaration(targetId);
  const matchesTarget = (cand: ts.Identifier | null): boolean =>
    cand !== null &&
    cand.text === targetId.text &&
    resolveLexicalDeclaration(cand) === targetDecl;

  let hit = false;
  const scan = (n: ts.Node): void => {
    if (hit) return;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const rhsHasSub = checkSubobject(n.right);
      const assigned = extractAssignedRootAndFirstKey(n.left);
      const fieldApplies =
        specificFieldKey === undefined ||
        assigned.isWholeRoot ||
        assigned.firstKey === null ||
        assigned.firstKey === specificFieldKey;
      if (
        (rhsHasSub && matchesTarget(assigned.root) && fieldApplies) ||
        (specificFieldKey === undefined &&
          assignmentDestructuresSubobject(n.left, matchesTarget, rhsHasSub))
      ) {
        hit = true;
        return;
      }
    }
    if (ts.isCallExpression(n)) {
      const checksArg = (a: ts.Expression) =>
        checkSubobject(ts.isSpreadElement(a) ? a.expression : a);
      const methodKey = ts.isPropertyAccessExpression(n.expression)
        ? n.expression.name.text
        : ts.isElementAccessExpression(n.expression)
          ? resolveStaticString(n.expression.argumentExpression)
          : null;
      if (
        methodKey !== null &&
        CONTAINER_MUTATOR_METHODS.has(methodKey) &&
        (ts.isPropertyAccessExpression(n.expression) ||
          ts.isElementAccessExpression(n.expression)) &&
        matchesTarget(unwrapRootIdentifier(n.expression.expression)) &&
        n.arguments.some(checksArg)
      ) {
        hit = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === 'Object' &&
        n.expression.name.text === 'assign' &&
        n.arguments.length >= 2 &&
        !ts.isSpreadElement(n.arguments[0]) &&
        matchesTarget(unwrapRootIdentifier(n.arguments[0])) &&
        n.arguments.slice(1).some(checksArg)
      ) {
        hit = true;
        return;
      }
    }
    ts.forEachChild(n, scan);
  };
  scan(sf);
  return hit;
}
