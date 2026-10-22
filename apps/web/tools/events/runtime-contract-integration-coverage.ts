import { dirname, extname, posix } from 'node:path';
import ts from '@typescript/typescript6';
import { runtimeIntegrationSuites } from './runtime-contract-integration-suites';

function modulePath(
  from: string,
  specifier: string,
  sources: ReadonlyMap<string, string>
) {
  const base = specifier.startsWith('@/')
    ? `apps/web/src/${specifier.slice(2)}`
    : specifier.startsWith('.')
      ? posix.normalize(`${dirname(from)}/${specifier}`)
      : /^(?:tools|src)\//.test(specifier)
        ? `apps/web/${specifier}`
        : '';
  if (!base) return undefined;
  return [
    base,
    ...['.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts'].map(
      (suffix) => base + suffix
    ),
  ].find((candidate) => sources.has(candidate));
}
function references(path: string, source: string) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(path).endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const imports: string[] = [];
  const mocks: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      !(
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        !node.importClause.name &&
        node.importClause.namedBindings.elements.length > 0 &&
        node.importClause.namedBindings.elements.every(
          (element) => element.isTypeOnly
        )
      ) &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(file);
      if (/(?:^|\.)build$/.test(name)) {
        for (const arg of node.arguments)
          if (ts.isObjectLiteralExpression(arg))
            for (const property of arg.properties)
              if (
                ts.isPropertyAssignment(property) &&
                property.name.getText(file) === 'entryPoints' &&
                ts.isArrayLiteralExpression(property.initializer)
              )
                for (const entry of property.initializer.elements)
                  if (ts.isStringLiteral(entry)) imports.push(entry.text);
      }

      const first = node.arguments[0];
      if (
        first &&
        ts.isStringLiteral(first) &&
        /^(?:vi|jest)\.(?:mock|doMock)$/.test(name)
      )
        mocks.push(first.text);
      if (
        first &&
        ts.isStringLiteral(first) &&
        ['import', 'require'].includes(name)
      )
        imports.push(first.text);
      if (/(?:^|\.)(?:execFileSync|execFile|spawn|startChild)$/.test(name)) {
        for (const arg of node.arguments)
          if (ts.isArrayLiteralExpression(arg))
            for (const element of arg.elements)
              if (ts.isStringLiteral(element)) imports.push(element.text);
      }
    }
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(file) === 'URL' &&
      node.arguments?.[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { imports, mocks };
}
/** Explicit associations only; missing tests, broken imports and mocks fail closed. */
export function hasRuntimeIntegrationCoverage(
  path: string,
  sources: ReadonlyMap<string, string>
): boolean {
  const suite = runtimeIntegrationSuites[path];
  if (
    !suite ||
    !/\.(?:test|spec|tests)\.(?:ts|tsx|mts|mjs|js)$/.test(suite) ||
    !sources.has(suite)
  )
    return false;
  const blocked = new Set(
    references(suite, sources.get(suite) ?? '').mocks.map((spec) =>
      modulePath(suite, spec, sources)
    )
  );
  const seen = new Set<string>();
  function reaches(current: string): boolean {
    if (blocked.has(current) || seen.has(current)) return false;
    seen.add(current);
    if (current === path) return true;
    const source = sources.get(current);
    if (!source) return false;
    const refs = references(current, source);
    for (const spec of refs.mocks)
      blocked.add(modulePath(current, spec, sources));
    return refs.imports.some((spec) => {
      const next = modulePath(current, spec, sources);
      return next ? reaches(next) : false;
    });
  }
  return reaches(suite);
}
