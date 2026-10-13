import ts from '@typescript/typescript6';
import { readsCredentialEnvironment } from './analytics-delivery-environment-access-analysis';

type VerifiedAtom = (node: ts.Expression) => boolean;

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
    ? unwrap(node.expression)
    : node;
}

function booleanLiteral(node: ts.Expression): boolean | undefined {
  const value = unwrap(node);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
}

function impliesVerified(
  expression: ts.Expression,
  outcome: boolean,
  verifiedAtom: VerifiedAtom
): boolean {
  const node = unwrap(expression);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return impliesVerified(node.operand, !outcome, verifiedAtom);
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return outcome
        ? impliesVerified(node.left, true, verifiedAtom) ||
            impliesVerified(node.right, true, verifiedAtom)
        : impliesVerified(node.left, false, verifiedAtom) &&
            impliesVerified(node.right, false, verifiedAtom);
    }
    if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return outcome
        ? impliesVerified(node.left, true, verifiedAtom) &&
            impliesVerified(node.right, true, verifiedAtom)
        : impliesVerified(node.left, false, verifiedAtom) ||
            impliesVerified(node.right, false, verifiedAtom);
    }
    const equality = [
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
    ].includes(node.operatorToken.kind);
    if (equality) {
      const right = booleanLiteral(node.right);
      const left = booleanLiteral(node.left);
      const unequal =
        node.operatorToken.kind ===
          ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken;
      if (right !== undefined) {
        return impliesVerified(
          node.left,
          outcome === unequal ? !right : right,
          verifiedAtom
        );
      }
      if (left !== undefined) {
        return impliesVerified(
          node.right,
          outcome === unequal ? !left : left,
          verifiedAtom
        );
      }
    }
  }
  return outcome && verifiedAtom(node);
}

function parse(path: string, source: string) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function hasLeadingDirective(path: string, source: string, value: string) {
  for (const statement of parse(path, source).statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === value) return true;
  }
  return false;
}

function bindingWrites(
  file: ts.SourceFile,
  identifier: ts.Identifier
): ts.Expression[] {
  const resolveBinding = (at: ts.Identifier) => {
    let resolved: ts.VariableDeclaration | ts.ParameterDeclaration | undefined;
    const visible = (node: ts.Node) => {
      const scope = ts.findAncestor(
        node.parent,
        (item) =>
          ts.isSourceFile(item) || ts.isBlock(item) || ts.isFunctionLike(item)
      );
      return Boolean(
        scope &&
          (scope === file || ts.findAncestor(at, (item) => item === scope))
      );
    };
    function find(node: ts.Node) {
      if (
        (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text === at.text &&
        node.pos < at.pos &&
        visible(node) &&
        (!resolved || node.pos > resolved.pos)
      )
        resolved = node;
      ts.forEachChild(node, find);
    }
    find(file);
    return resolved;
  };
  const binding = resolveBinding(identifier);
  if (!binding || ts.isParameter(binding)) return [];
  const writes: ts.Expression[] = binding.initializer
    ? [binding.initializer]
    : [];
  function collect(node: ts.Node) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ts.isIdentifier(node.left) &&
      node.left.text === identifier.text &&
      node.pos < identifier.pos
    ) {
      if (resolveBinding(node.left) === binding) writes.push(node.right);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(
        node.operator
      ) &&
      ts.isIdentifier(node.operand) &&
      node.operand.text === identifier.text &&
      resolveBinding(node.operand) === binding
    )
      writes.push(node);
    ts.forEachChild(node, collect);
  }
  collect(file);
  return writes;
}

// biome-ignore format: compact lexical import proof stays within the 300-line verifier gate.
function identifierResolvesToNamedImport(identifier: ts.Identifier, specifier: string, exportedName: string): boolean {
  const bindingHasName = (name: ts.BindingName): boolean => ts.isIdentifier(name) ? name.text === identifier.text : name.elements.some((element) => ts.isBindingElement(element) && bindingHasName(element.name));
  const scopes: ts.Node[] = [];
  for (let node: ts.Node | undefined = identifier.parent; node; node = node.parent) if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node)) scopes.push(node);
  for (const scope of scopes) {
    const declarations: ts.Node[] = [];
    const visit = (node: ts.Node) => {
      const declaresIdentifier = ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && bindingHasName(node.name)) || (ts.isFunctionDeclaration(node) && node.name?.text === identifier.text) || ((ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) && node.name.text === identifier.text);
      if (declaresIdentifier) declarations.push(node);
      if (
        node !== scope &&
        (ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node))
      )
        return;
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(scope, visit);
    if (!declarations.length) continue;
    return declarations.length === 1 && declarations.some((node) => {
      if (!ts.isImportSpecifier(node) && !ts.isNamespaceImport(node)) return false;
      if (ts.isImportSpecifier(node) && node.isTypeOnly) return false;
      const declaration = ts.isNamespaceImport(node) ? node.parent.parent : node.parent.parent.parent;
      return (
        ts.isImportDeclaration(declaration) &&
        ts.isStringLiteral(declaration.moduleSpecifier) &&
        declaration.moduleSpecifier.text === specifier &&
        (ts.isNamespaceImport(node) ? exportedName === '*' : (node.propertyName?.text ?? node.name.text) === exportedName)
      );
    });
  }
  return false;
}

export const analyticsDeliveryAuthoritySourceGuards = {
  branchImpliesVerified: impliesVerified,
  hasLeadingDirective,
  merchantArgumentIsVerified: (
    node: ts.Expression,
    verifiedAtom: VerifiedAtom
  ) => verifiedAtom(unwrap(node)),
  bindingWrites,
  identifierResolvesToNamedImport,
  readsCredentialEnvironment,
} as const;
