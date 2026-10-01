import ts from '@typescript/typescript6';

function moduleExpression(node: ts.Node): ts.Expression | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier
  ) {
    return node.moduleSpecifier;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    return node.moduleReference.expression;
  }
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
  ) {
    return node.arguments[0];
  }
  return undefined;
}

function localTypeScriptFile(specifier: string): string | undefined {
  const local = specifier.startsWith('./') ? specifier.slice(2) : undefined;
  if (!local || local.includes('/')) return undefined;
  return /\.[cm]?tsx?$/.test(local) ? local : `${local}.ts`;
}

export function findImportedSuccessorSuites(
  source: string,
  successors: readonly string[]
): string[] {
  const imported = new Set<string>();
  const sourceFile = ts.createSourceFile(
    'split-manifest.test.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  function visit(node: ts.Node) {
    const expression = moduleExpression(node);
    if (expression && ts.isStringLiteralLike(expression)) {
      const file = localTypeScriptFile(expression.text);
      if (file) imported.add(file);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return successors.filter((successor) => imported.has(successor));
}
