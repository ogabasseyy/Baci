import ts from '@typescript/typescript6';

export function resolveImportedBinding({
  ast,
  localName,
  resolveModule,
}: {
  ast: ts.SourceFile;
  localName: string;
  resolveModule: (specifier: string) => string | null;
}): { exportName: string; modulePath: string } | null {
  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    const element = statement.importClause.namedBindings.elements.find(
      (candidate) => candidate.name.text === localName
    );
    if (!element) continue;
    const modulePath = resolveModule(statement.moduleSpecifier.text);
    return modulePath
      ? {
          exportName: (element.propertyName ?? element.name).text,
          modulePath,
        }
      : null;
  }
  return null;
}
