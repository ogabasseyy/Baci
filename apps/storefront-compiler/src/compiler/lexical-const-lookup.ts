import ts from '@typescript/typescript6';
import { bindingContainsName, hasDeclareModifier } from './jsx-export-graph';

export function hasHoistedVarInScope(root: ts.Node, target: string): boolean {
  let found = false;
  const walk = (node: ts.Node): void => {
    if (found) return;
    if (
      node !== root &&
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node))
    ) {
      return;
    }
    if (
      ts.isVariableDeclarationList(node) &&
      (node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0 &&
      node.declarations.some((d) => bindingContainsName(d.name, target))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(root);
  return found;
}

function isLoopInitializerBinding(node: ts.Node, target: string): boolean {
  if (
    (ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node)) &&
    node.initializer &&
    ts.isVariableDeclarationList(node.initializer)
  ) {
    return node.initializer.declarations.some((d) =>
      bindingContainsName(d.name, target)
    );
  }
  return false;
}

export function collectPropertyMutatedIdentifiers(
  sf: ts.SourceFile
): ReadonlySet<string> {
  const mutated = new Set<string>();
  const aliasLinks = new Map<string, Set<string>>();
  const unwrapRoot = (target: ts.Node): ts.Identifier | null => {
    let cur: ts.Node = target;
    while (
      ts.isPropertyAccessExpression(cur) ||
      ts.isElementAccessExpression(cur) ||
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isSatisfiesExpression(cur) ||
      ts.isNonNullExpression(cur)
    ) {
      cur = cur.expression;
    }
    return ts.isIdentifier(cur) ? cur : null;
  };
  const walk = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const rhsRoot = unwrapRoot(node.initializer);
      if (rhsRoot) {
        const recordAlias = (b: ts.BindingName): void => {
          if (ts.isIdentifier(b)) {
            let set = aliasLinks.get(b.text);
            if (!set) {
              set = new Set();
              aliasLinks.set(b.text, set);
            }
            set.add(rhsRoot.text);
          } else {
            for (const el of b.elements) {
              if (ts.isBindingElement(el)) recordAlias(el.name);
            }
          }
        };
        recordAlias(node.name);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left))
    ) {
      const r = unwrapRoot(node.left);
      if (r) mutated.add(r.text);
    } else if (ts.isDeleteExpression(node)) {
      const r = unwrapRoot(node.expression);
      if (r) mutated.add(r.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);

  const queue = Array.from(mutated);
  while (queue.length > 0) {
    const id = queue.pop();
    if (!id) continue;
    const sources = aliasLinks.get(id);
    if (!sources) continue;
    for (const src of sources) {
      if (!mutated.has(src)) {
        mutated.add(src);
        queue.push(src);
      }
    }
  }
  return mutated;
}

export function hasInnerShadowing(atNode: ts.Node, target: string): boolean {
  let cur: ts.Node | undefined = atNode.parent;
  while (cur) {
    if (isLoopInitializerBinding(cur, target)) return true;
    if (
      ts.isCatchClause(cur) &&
      cur.variableDeclaration &&
      bindingContainsName(cur.variableDeclaration.name, target)
    ) {
      return true;
    }
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isConstructorDeclaration(cur)
    ) {
      if (cur.parameters.some((p) => bindingContainsName(p.name, target))) {
        return true;
      }
      if (ts.isFunctionExpression(cur) && cur.name?.text === target) {
        return true;
      }
      if (hasHoistedVarInScope(cur, target)) return true;
    }
    if (ts.isSourceFile(cur)) {
      return hasHoistedVarInScope(cur, target);
    }
    if (ts.isBlock(cur)) {
      for (const stmt of cur.statements) {
        if (hasDeclareModifier(stmt)) continue;
        if (
          ts.isVariableStatement(stmt) &&
          stmt.declarationList.declarations.some((d) =>
            bindingContainsName(d.name, target)
          )
        ) {
          return true;
        }
        if (
          (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
          stmt.name?.text === target
        ) {
          return true;
        }
      }
    }
    cur = cur.parent;
  }
  return false;
}

export function findLexicalConstDeclaration(
  atNode: ts.Node,
  target: string
): {
  decl: ts.VariableDeclaration;
  bindingEl?: ts.BindingElement;
} | null {
  let cur: ts.Node | undefined = atNode.parent;
  while (cur) {
    if (isLoopInitializerBinding(cur, target)) return null;
    if (
      ts.isCatchClause(cur) &&
      cur.variableDeclaration &&
      bindingContainsName(cur.variableDeclaration.name, target)
    ) {
      return null;
    }
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isConstructorDeclaration(cur)
    ) {
      if (cur.parameters.some((p) => bindingContainsName(p.name, target))) {
        return null;
      }
      if (ts.isFunctionExpression(cur) && cur.name?.text === target) {
        return null;
      }
      if (hasHoistedVarInScope(cur, target)) return null;
    }
    if (ts.isSourceFile(cur) && hasHoistedVarInScope(cur, target)) {
      return null;
    }
    if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
      for (const stmt of cur.statements) {
        if (hasDeclareModifier(stmt)) continue;
        if (
          (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
          stmt.name?.text === target
        ) {
          return null;
        }
        if (ts.isVariableStatement(stmt)) {
          const isConst =
            (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
          for (const d of stmt.declarationList.declarations) {
            if (!bindingContainsName(d.name, target)) continue;
            if (!isConst || !d.initializer) return null;
            if (ts.isIdentifier(d.name) && d.name.text === target) {
              return { decl: d };
            }
            if (ts.isObjectBindingPattern(d.name)) {
              for (const el of d.name.elements) {
                if (
                  !el.dotDotDotToken &&
                  ts.isIdentifier(el.name) &&
                  el.name.text === target
                ) {
                  return { decl: d, bindingEl: el };
                }
              }
            }
            return null;
          }
        }
      }
    }
    cur = cur.parent;
  }
  return null;
}
