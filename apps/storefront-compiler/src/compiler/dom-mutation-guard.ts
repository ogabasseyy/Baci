import ts from '@typescript/typescript6';
import { FORBIDDEN_DOM_MUTATION_MEMBERS } from './banned-specifiers';
import { resolveStaticString } from './const-string-fold';
import {
  assignmentDestructuresSubobject,
  bindingDestructuresSubobject,
  MUTABLE_DOM_SUBOBJECT_MEMBERS,
} from './dom-subobject-destructure';

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

function hasMutableDomSubobjectInChain(
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
    return hasMutableDomSubobjectInChain(expr.expression, seen);
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return (
      MUTABLE_DOM_SUBOBJECT_MEMBERS.has(expr.name.text) ||
      hasMutableDomSubobjectInChain(expr.expression, seen)
    );
  }
  if (ts.isElementAccessExpression(expr)) {
    const key = resolveStaticString(expr.argumentExpression);
    return (
      (key !== null && MUTABLE_DOM_SUBOBJECT_MEMBERS.has(key)) ||
      hasMutableDomSubobjectInChain(expr.expression, seen)
    );
  }
  if (ts.isCallExpression(expr)) {
    if (expr.arguments.some((a) => hasMutableDomSubobjectInChain(a, seen))) {
      return true;
    }
    if (
      ts.isPropertyAccessExpression(expr.expression) ||
      ts.isElementAccessExpression(expr.expression)
    ) {
      return hasMutableDomSubobjectInChain(expr.expression.expression, seen);
    }
    if (ts.isIdentifier(expr.expression)) {
      let cur: ts.Node | undefined = expr.parent;
      while (cur) {
        if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
          for (const s of cur.statements) {
            if (
              ts.isFunctionDeclaration(s) &&
              s.name?.text === expr.expression.text
            ) {
              return collectFunctionReturns(s).some((r) =>
                hasMutableDomSubobjectInChain(r, seen)
              );
            }
            if (ts.isVariableStatement(s)) {
              for (const d of s.declarationList.declarations) {
                if (
                  ts.isIdentifier(d.name) &&
                  d.name.text === expr.expression.text &&
                  d.initializer &&
                  (ts.isArrowFunction(d.initializer) ||
                    ts.isFunctionExpression(d.initializer))
                ) {
                  return collectFunctionReturns(d.initializer).some((r) =>
                    hasMutableDomSubobjectInChain(r, seen)
                  );
                }
              }
            }
          }
        }
        cur = cur.parent;
      }
    }
    return false;
  }
  if (ts.isIdentifier(expr)) {
    let cur: ts.Node | undefined = expr.parent;
    while (cur) {
      if (
        ts.isFunctionDeclaration(cur) ||
        ts.isFunctionExpression(cur) ||
        ts.isArrowFunction(cur) ||
        ts.isMethodDeclaration(cur)
      ) {
        for (const p of cur.parameters) {
          if (bindingDestructuresSubobject(p.name, expr.text, false)) {
            return true;
          }
        }
      }
      if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
        for (const s of cur.statements) {
          if (!ts.isVariableStatement(s)) continue;
          for (const d of s.declarationList.declarations) {
            const initSub = Boolean(
              d.initializer &&
                hasMutableDomSubobjectInChain(d.initializer, seen)
            );
            if (
              ts.isIdentifier(d.name) &&
              d.name.text === expr.text &&
              initSub
            ) {
              return true;
            }
            if (bindingDestructuresSubobject(d.name, expr.text, initSub)) {
              return true;
            }
          }
        }
      }
      cur = cur.parent;
    }
    let assignHit = false;
    const scanAssign = (n: ts.Node): void => {
      if (assignHit) return;
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        assignmentDestructuresSubobject(
          n.left,
          expr.text,
          hasMutableDomSubobjectInChain(n.right, seen)
        )
      ) {
        assignHit = true;
        return;
      }
      ts.forEachChild(n, scanAssign);
    };
    scanAssign(expr.getSourceFile());
    if (assignHit) return true;
  }
  return false;
}

export function collectReassignedIdentifiers(
  sf: ts.SourceFile
): ReadonlySet<string> {
  const mutated = new Set<string>();
  const walk = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isWriteTargetExpression(node)) {
      mutated.add(node.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return mutated;
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
    (receiver !== undefined && hasMutableDomSubobjectInChain(receiver))
  );
}
