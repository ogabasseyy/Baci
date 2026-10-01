/**
 * Resolves privileged calls through named, namespace, and dynamic imports plus
 * local, named, and star re-exports. Recursive export resolution tracks visited
 * module/export pairs to break cycles. This structural analysis is intentionally
 * not scope-aware, so a local binding that shadows an import is not distinguished.
 */
import { dirname, join, normalize } from 'node:path';
import ts from '@typescript/typescript6';
import { resolveImportedBinding } from './agentic-dva-import-binding-resolution-test-support';
import { collectPrivilegedAliases } from './agentic-dva-privileged-alias-test-support';

interface SourceRecord {
  path: string;
  source: string;
}

const parsedSourceCache = new Map<
  string,
  { ast: ts.SourceFile; source: string }
>();

function countCalls({
  definitionPath,
  file,
  functionName,
  sourcesByPath,
}: {
  definitionPath: string;
  file: SourceRecord;
  functionName: string;
  sourcesByPath: ReadonlyMap<string, string>;
}): number {
  const ast = parseSource(file);
  const bindings = new Set(file.path === definitionPath ? [functionName] : []);
  const namespaces = new Map<string, string>();
  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause?.namedBindings
    ) {
      continue;
    }
    const modulePath = resolveModulePath(
      file.path,
      statement.moduleSpecifier.text,
      sourcesByPath
    );
    if (!modulePath) continue;
    const imported = statement.importClause.namedBindings;
    if (ts.isNamespaceImport(imported)) {
      namespaces.set(imported.name.text, modulePath);
      continue;
    }
    for (const element of imported.elements) {
      const exportedName = (element.propertyName ?? element.name).text;
      if (
        resolvesTargetExport({
          definitionPath,
          exportName: exportedName,
          functionName,
          modulePath,
          sourcesByPath,
        })
      ) {
        bindings.add(element.name.text);
      }
    }
  }
  const collectDynamicBindings = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) {
      const specifier = dynamicImportSpecifier(node.initializer);
      const modulePath = specifier
        ? resolveModulePath(file.path, specifier, sourcesByPath)
        : null;
      if (modulePath && ts.isIdentifier(node.name)) {
        namespaces.set(node.name.text, modulePath);
      }
      if (modulePath && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const exportedName = (element.propertyName ?? element.name).getText(
            ast
          );
          if (
            ts.isIdentifier(element.name) &&
            resolvesTargetExport({
              definitionPath,
              exportName: exportedName,
              functionName,
              modulePath,
              sourcesByPath,
            })
          ) {
            bindings.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, collectDynamicBindings);
  };
  collectDynamicBindings(ast);
  collectPrivilegedAliases({
    ast,
    bindings,
    namespaces,
    resolvesTarget: (modulePath, exportName) =>
      resolvesTargetExport({
        definitionPath,
        exportName,
        functionName,
        modulePath,
        sourcesByPath,
      }),
  });
  let calls = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        bindings.has(node.expression.text)
      ) {
        calls += 1;
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression)
      ) {
        const modulePath = namespaces.get(node.expression.expression.text);
        if (
          modulePath &&
          resolvesTargetExport({
            definitionPath,
            exportName: node.expression.name.text,
            functionName,
            modulePath,
            sourcesByPath,
          })
        ) {
          calls += 1;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return calls;
}

function resolvesTargetExport({
  definitionPath,
  exportName,
  functionName,
  modulePath,
  sourcesByPath,
  visited = new Set<string>(),
}: {
  definitionPath: string;
  exportName: string;
  functionName: string;
  modulePath: string;
  sourcesByPath: ReadonlyMap<string, string>;
  visited?: Set<string>;
}): boolean {
  if (modulePath === definitionPath) return exportName === functionName;
  const visitKey = `${modulePath}:${exportName}`;
  if (visited.has(visitKey)) return false;
  visited.add(visitKey);
  const source = sourcesByPath.get(modulePath);
  if (!source) return false;
  const ast = parseSource({ path: modulePath, source });
  for (const statement of ast.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier) {
      if (
        !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== exportName) continue;
        const localName = (element.propertyName ?? element.name).text;
        const importedBinding = resolveImportedBinding({
          ast,
          localName,
          resolveModule: (specifier) =>
            resolveModulePath(modulePath, specifier, sourcesByPath),
        });
        if (!importedBinding) continue;
        return resolvesTargetExport({
          definitionPath,
          exportName: importedBinding.exportName,
          functionName,
          modulePath: importedBinding.modulePath,
          sourcesByPath,
          visited,
        });
      }
      continue;
    }
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const upstreamPath = resolveModulePath(
      modulePath,
      statement.moduleSpecifier.text,
      sourcesByPath
    );
    if (!upstreamPath) continue;
    if (!statement.exportClause) {
      if (
        resolvesTargetExport({
          definitionPath,
          exportName,
          functionName,
          modulePath: upstreamPath,
          sourcesByPath,
          visited,
        })
      ) {
        return true;
      }
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      if (element.name.text !== exportName) continue;
      return resolvesTargetExport({
        definitionPath,
        exportName: (element.propertyName ?? element.name).text,
        functionName,
        modulePath: upstreamPath,
        sourcesByPath,
        visited,
      });
    }
  }
  return false;
}

function parseSource(file: SourceRecord): ts.SourceFile {
  const cached = parsedSourceCache.get(file.path);
  if (cached?.source === file.source) return cached.ast;
  const ast = ts.createSourceFile(
    file.path,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  parsedSourceCache.set(file.path, { ast, source: file.source });
  return ast;
}

function dynamicImportSpecifier(initializer?: ts.Expression): string | null {
  let expression = initializer;
  while (
    expression &&
    (ts.isAwaitExpression(expression) ||
      ts.isParenthesizedExpression(expression))
  ) {
    expression = expression.expression;
  }
  if (
    !expression ||
    !ts.isCallExpression(expression) ||
    expression.expression.kind !== ts.SyntaxKind.ImportKeyword ||
    !ts.isStringLiteral(expression.arguments[0])
  ) {
    return null;
  }
  return expression.arguments[0].text;
}

function resolveModulePath(
  importerPath: string,
  specifier: string,
  sourcesByPath: ReadonlyMap<string, string>
): string | null {
  const workspaceRoot = importerPath.match(/^(?:apps|packages)\/[^/]+/)?.[0];
  const base = specifier.startsWith('@/')
    ? workspaceRoot
      ? join(workspaceRoot, 'src', specifier.slice(2))
      : null
    : specifier.startsWith('.')
      ? join(dirname(importerPath), specifier)
      : null;
  if (!base) return null;
  const stem = normalize(base).replace(/\.(?:c|m)?js$/, '');
  return (
    [
      stem,
      `${stem}.ts`,
      `${stem}.tsx`,
      join(stem, 'index.ts'),
      join(stem, 'index.tsx'),
    ].find((candidate) => sourcesByPath.has(candidate)) ?? null
  );
}

export const privilegedCallerAnalysis = { countCalls } as const;
