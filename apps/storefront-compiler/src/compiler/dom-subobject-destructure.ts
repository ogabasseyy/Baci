import ts from '@typescript/typescript6';
import { resolveStaticString } from './const-string-fold';
import { bindingContainsName } from './jsx-export-graph';

export const MUTABLE_DOM_SUBOBJECT_MEMBERS: ReadonlySet<string> = new Set([
  'style',
  'attributes',
]);

function findHoistedVarDecl(root: ts.Node, name: string): ts.Node | null {
  let hit: ts.Node | null = null;
  const walk = (n: ts.Node): void => {
    if (hit) return;
    if (
      n !== root &&
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isSetAccessorDeclaration(n) ||
        ts.isConstructorDeclaration(n))
    ) {
      return;
    }
    if (
      ts.isVariableDeclarationList(n) &&
      (n.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0
    ) {
      const found = n.declarations.find((d) =>
        bindingContainsName(d.name, name)
      );
      if (found) {
        hit = found;
        return;
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(root);
  return hit;
}

export function resolveLexicalDeclaration(id: ts.Identifier): ts.Node | null {
  const name = id.text;
  let cur: ts.Node | undefined = id.parent;
  while (cur) {
    if (
      ts.isCatchClause(cur) &&
      cur.variableDeclaration &&
      bindingContainsName(cur.variableDeclaration.name, name)
    ) {
      return cur.variableDeclaration;
    }
    if (
      (ts.isForStatement(cur) ||
        ts.isForInStatement(cur) ||
        ts.isForOfStatement(cur)) &&
      cur.initializer &&
      ts.isVariableDeclarationList(cur.initializer)
    ) {
      const hit = cur.initializer.declarations.find((d) =>
        bindingContainsName(d.name, name)
      );
      if (hit) return hit;
    }
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isSetAccessorDeclaration(cur) ||
      ts.isConstructorDeclaration(cur)
    ) {
      const hoisted = findHoistedVarDecl(cur, name);
      if (hoisted) return hoisted;
      const param = cur.parameters.find((p) =>
        bindingContainsName(p.name, name)
      );
      if (param) return param;
      if (ts.isFunctionExpression(cur) && cur.name?.text === name) return cur;
    }
    if (ts.isBlock(cur) || ts.isSourceFile(cur) || ts.isCaseBlock(cur)) {
      const stmts = ts.isCaseBlock(cur)
        ? cur.clauses.flatMap((cl) => cl.statements)
        : cur.statements;
      for (const s of stmts) {
        if (ts.isVariableStatement(s)) {
          const hit = s.declarationList.declarations.find((d) =>
            bindingContainsName(d.name, name)
          );
          if (hit) return hit;
        } else if (
          (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) &&
          s.name?.text === name
        ) {
          return s;
        }
      }
      if (ts.isSourceFile(cur)) {
        const hoisted = findHoistedVarDecl(cur, name);
        if (hoisted) return hoisted;
      }
    }
    cur = cur.parent;
  }
  return null;
}

function resolvePropKey(keyNode: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(keyNode) ||
    ts.isStringLiteral(keyNode) ||
    ts.isNumericLiteral(keyNode)
  ) {
    return keyNode.text;
  }
  return ts.isComputedPropertyName(keyNode)
    ? resolveStaticString(keyNode.expression)
    : null;
}

export function bindingDestructuresSubobject(
  pattern: ts.BindingName,
  target: string,
  underSubobject = false
): boolean {
  if (ts.isIdentifier(pattern)) {
    return underSubobject && pattern.text === target;
  }
  if (ts.isArrayBindingPattern(pattern)) {
    return pattern.elements.some(
      (el) =>
        ts.isBindingElement(el) &&
        bindingDestructuresSubobject(el.name, target, underSubobject)
    );
  }
  for (const el of pattern.elements) {
    if (el.dotDotDotToken) {
      if (bindingDestructuresSubobject(el.name, target, underSubobject)) {
        return true;
      }
      continue;
    }
    const key = el.propertyName
      ? resolvePropKey(el.propertyName)
      : ts.isIdentifier(el.name)
        ? el.name.text
        : null;
    const nextUnder =
      underSubobject ||
      (key !== null && MUTABLE_DOM_SUBOBJECT_MEMBERS.has(key));
    if (bindingDestructuresSubobject(el.name, target, nextUnder)) return true;
  }
  return false;
}

export function assignmentDestructuresSubobject(
  lhs: ts.Expression,
  target: string | ((id: ts.Identifier) => boolean),
  underSubobject: boolean
): boolean {
  const matches = (id: ts.Identifier): boolean =>
    typeof target === 'function' ? target(id) : id.text === target;
  if (ts.isParenthesizedExpression(lhs)) {
    return assignmentDestructuresSubobject(
      lhs.expression,
      target,
      underSubobject
    );
  }
  if (ts.isIdentifier(lhs)) return underSubobject && matches(lhs);
  if (ts.isArrayLiteralExpression(lhs)) {
    return lhs.elements.some((el) =>
      assignmentDestructuresSubobject(
        ts.isSpreadElement(el) ? el.expression : el,
        target,
        underSubobject
      )
    );
  }
  if (ts.isObjectLiteralExpression(lhs)) {
    return lhs.properties.some((prop) => {
      if (ts.isSpreadAssignment(prop)) {
        return assignmentDestructuresSubobject(
          prop.expression,
          target,
          underSubobject
        );
      }
      if (ts.isShorthandPropertyAssignment(prop)) {
        return (
          (underSubobject ||
            MUTABLE_DOM_SUBOBJECT_MEMBERS.has(prop.name.text)) &&
          matches(prop.name)
        );
      }
      if (ts.isPropertyAssignment(prop)) {
        const k = resolvePropKey(prop.name);
        const next =
          underSubobject ||
          (k !== null && MUTABLE_DOM_SUBOBJECT_MEMBERS.has(k));
        return assignmentDestructuresSubobject(prop.initializer, target, next);
      }
      return false;
    });
  }
  return false;
}
