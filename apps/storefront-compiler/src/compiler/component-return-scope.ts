import ts from '@typescript/typescript6';

function bindingHasName(b: ts.BindingName, target: string): boolean {
  if (ts.isIdentifier(b)) return b.text === target;
  return b.elements.some(
    (el) => ts.isBindingElement(el) && bindingHasName(el.name, target)
  );
}

function hasLoopBinding(node: ts.Node, target: string): boolean {
  return (
    (ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node)) &&
    node.initializer !== undefined &&
    ts.isVariableDeclarationList(node.initializer) &&
    node.initializer.declarations.some((d) => bindingHasName(d.name, target))
  );
}

export function isLexicallyBound(atNode: ts.Node, target: string): boolean {
  let cur: ts.Node | undefined = atNode.parent;
  while (cur) {
    if (hasLoopBinding(cur, target)) return true;
    if (
      ts.isCatchClause(cur) &&
      cur.variableDeclaration &&
      bindingHasName(cur.variableDeclaration.name, target)
    ) {
      return true;
    }
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isGetAccessorDeclaration(cur) ||
      ts.isSetAccessorDeclaration(cur) ||
      ts.isConstructorDeclaration(cur)
    ) {
      if (cur.parameters.some((p) => bindingHasName(p.name, target))) {
        return true;
      }
      if (ts.isFunctionExpression(cur) && cur.name?.text === target) {
        return true;
      }
    }
    if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
      for (const s of cur.statements) {
        if (
          ts.isVariableStatement(s) &&
          s.declarationList.declarations.some((d) =>
            bindingHasName(d.name, target)
          )
        ) {
          return true;
        }
        if (
          (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) &&
          s.name?.text === target
        ) {
          return true;
        }
        if (ts.isImportDeclaration(s) && s.importClause) {
          const c = s.importClause;
          if (c.name?.text === target) return true;
          if (c.namedBindings) {
            if (ts.isNamespaceImport(c.namedBindings)) {
              if (c.namedBindings.name.text === target) return true;
            } else if (
              c.namedBindings.elements.some((el) => el.name.text === target)
            ) {
              return true;
            }
          }
        }
      }
    }
    cur = cur.parent;
  }
  return false;
}

export function resolveLocalConstInit(
  ident: ts.Identifier
): ts.Expression | null {
  let cur: ts.Node | undefined = ident.parent;
  while (cur) {
    if (hasLoopBinding(cur, ident.text)) return null;
    if (
      ts.isCatchClause(cur) &&
      cur.variableDeclaration &&
      bindingHasName(cur.variableDeclaration.name, ident.text)
    ) {
      return null;
    }
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isGetAccessorDeclaration(cur) ||
      ts.isSetAccessorDeclaration(cur)
    ) {
      if (cur.parameters.some((p) => bindingHasName(p.name, ident.text))) {
        return null;
      }
      if (ts.isFunctionExpression(cur) && cur.name?.text === ident.text) {
        return null;
      }
    }
    if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
      for (const s of cur.statements) {
        if (
          (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) &&
          s.name?.text === ident.text
        ) {
          return null;
        }
        if (!ts.isVariableStatement(s)) continue;
        const isConst = (s.declarationList.flags & ts.NodeFlags.Const) !== 0;
        for (const d of s.declarationList.declarations) {
          if (bindingHasName(d.name, ident.text)) {
            return isConst && ts.isIdentifier(d.name) && d.initializer
              ? d.initializer
              : null;
          }
        }
      }
    }
    cur = cur.parent;
  }
  return null;
}
