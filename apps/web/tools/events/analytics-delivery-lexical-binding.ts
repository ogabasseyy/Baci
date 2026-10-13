import ts from '@typescript/typescript6';

function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingNames(element.name) : []
  );
}

function lexicalScope(node: ts.Node): ts.Node | undefined {
  return ts.findAncestor(
    node.parent,
    (candidate) =>
      ts.isSourceFile(candidate) ||
      ts.isBlock(candidate) ||
      ts.isFunctionLike(candidate) ||
      ts.isForStatement(candidate) ||
      ts.isForInStatement(candidate) ||
      ts.isForOfStatement(candidate) ||
      ts.isCaseBlock(candidate) ||
      ts.isModuleBlock(candidate) ||
      ts.isCatchClause(candidate) ||
      ts.isClassStaticBlockDeclaration(candidate)
  );
}

function isAncestor(ancestor: ts.Node, node: ts.Node): boolean {
  return Boolean(
    ancestor === node || ts.findAncestor(node, (item) => item === ancestor)
  );
}

export function resolveLexicalBinding(
  file: ts.SourceFile,
  identifier: ts.Identifier,
  at: ts.Node
): ts.VariableDeclaration | ts.ParameterDeclaration | undefined {
  const candidates: Array<ts.VariableDeclaration | ts.ParameterDeclaration> =
    [];
  function visit(node: ts.Node) {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      bindingNames(node.name).some((name) => name.text === identifier.text) &&
      node.pos < at.pos
    ) {
      const scope = lexicalScope(node);
      if (scope && isAncestor(scope, at)) candidates.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return candidates.sort((left, right) => {
    const leftScope = lexicalScope(left);
    const rightScope = lexicalScope(right);
    if (leftScope && rightScope) {
      if (leftScope === rightScope) return right.pos - left.pos;
      if (isAncestor(leftScope, rightScope)) return 1;
      if (isAncestor(rightScope, leftScope)) return -1;
    }
    return right.pos - left.pos;
  })[0];
}
