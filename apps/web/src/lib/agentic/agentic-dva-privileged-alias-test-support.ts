import ts from '@typescript/typescript6';

interface AliasCollectionInput {
  ast: ts.SourceFile;
  bindings: Set<string>;
  namespaces: ReadonlyMap<string, string>;
  resolvesTarget(namespace: string, exportName: string): boolean;
}

export function collectPrivilegedAliases({
  ast,
  bindings,
  namespaces,
  resolvesTarget,
}: AliasCollectionInput): void {
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node)) {
        if (
          ts.isIdentifier(node.name) &&
          expressionTargetsPrivilegedExport(
            node.initializer,
            bindings,
            namespaces,
            resolvesTarget
          ) &&
          !bindings.has(node.name.text)
        ) {
          bindings.add(node.name.text);
          changed = true;
        }
        if (
          ts.isObjectBindingPattern(node.name) &&
          node.initializer &&
          ts.isIdentifier(node.initializer)
        ) {
          const namespace = namespaces.get(node.initializer.text);
          if (namespace) {
            for (const element of node.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const exportName = (element.propertyName ?? element.name).getText(
                ast
              );
              if (
                resolvesTarget(namespace, exportName) &&
                !bindings.has(element.name.text)
              ) {
                bindings.add(element.name.text);
                changed = true;
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
}

function expressionTargetsPrivilegedExport(
  expression: ts.Expression | undefined,
  bindings: ReadonlySet<string>,
  namespaces: ReadonlyMap<string, string>,
  resolvesTarget: (namespace: string, exportName: string) => boolean
): boolean {
  if (!expression) return false;
  if (ts.isIdentifier(expression)) return bindings.has(expression.text);
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return expressionTargetsPrivilegedExport(
      expression.expression,
      bindings,
      namespaces,
      resolvesTarget
    );
  }
  if (
    !ts.isPropertyAccessExpression(expression) ||
    !ts.isIdentifier(expression.expression)
  ) {
    return false;
  }
  const namespace = namespaces.get(expression.expression.text);
  return Boolean(namespace && resolvesTarget(namespace, expression.name.text));
}
