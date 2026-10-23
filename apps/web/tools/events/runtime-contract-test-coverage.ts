import { dirname, extname } from 'node:path';
import ts from '@typescript/typescript6';

const extension = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;
/** Same module tests may use a native runner qualifier or TypeScript for JS. */
export function associatedRuntimeTests(
  path: string,
  sources: ReadonlyMap<string, string>
): string[] {
  const stem = path.replace(extension, '');
  return [...sources.keys()].filter((candidate) => {
    if (dirname(candidate) !== dirname(path)) return false;
    const testStem = candidate.replace(extension, '');
    return new RegExp(
      `^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.[\\w-]+)*\\.(?:test|tests|spec|specs)$`
    ).test(testStem);
  });
}

function literal(expression: ts.Expression): boolean {
  if (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  )
    return literal(expression.expression);
  if (
    ts.isLiteralExpression(expression) ||
    [
      ts.SyntaxKind.TrueKeyword,
      ts.SyntaxKind.FalseKeyword,
      ts.SyntaxKind.NullKeyword,
    ].includes(expression.kind)
  )
    return true;
  if (ts.isPrefixUnaryExpression(expression))
    return literal(expression.operand);
  if (ts.isArrayLiteralExpression(expression))
    return expression.elements.every(
      (element) => ts.isExpression(element) && literal(element)
    );
  if (ts.isObjectLiteralExpression(expression))
    return expression.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        !ts.isComputedPropertyName(property.name) &&
        literal(property.initializer)
    );
  return false;
}
/** Pure constants/types/barrels need no runtime test; executable initializers do. */
export function hasRuntimeBehavior(path: string, source: string): boolean {
  const kind = extname(path).endsWith('x')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
  return file.statements.some((statement) => {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isEmptyStatement(statement)
    )
      return false;
    if (
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression)
    )
      return false;
    if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.flags & ts.NodeFlags.Const
    )
      return statement.declarationList.declarations.some(
        (declaration) =>
          !ts.isIdentifier(declaration.name) ||
          !declaration.initializer ||
          !literal(declaration.initializer)
      );
    return true;
  });
}

/** Resolve removed qualified/cross-language tests back to existing source modules. */
export function runtimeContractPaths(
  paths: readonly string[],
  sources: ReadonlyMap<string, string>
): string[] {
  const result = new Set(paths);
  for (const path of paths) {
    if (
      !/\.(?:test|tests|spec|specs)\.(?:ts|tsx|mts|mjs|js|jsx|cts|cjs)$/.test(
        path
      )
    )
      continue;
    const probe = new Map([[path, '']]);
    for (const source of sources.keys())
      if (
        dirname(source) === dirname(path) &&
        associatedRuntimeTests(source, probe).length
      )
        result.add(source);
    const stem = path.replace(
      /\.(?:test|tests|spec|specs)\.(?:ts|tsx|mts|mjs|js|jsx|cts|cjs)$/,
      ''
    );
    for (const ext of [
      '.ts',
      '.tsx',
      '.mts',
      '.mjs',
      '.js',
      '.jsx',
      '.cts',
      '.cjs',
    ])
      if (sources.has(stem + ext)) result.add(stem + ext);
  }
  return [...result];
}

const sourceExtension = '(cjs|cts|js|jsx|mjs|mts|ts|tsx)';
export function colocatedTestPath(path: string): string {
  return path.replace(
    new RegExp(`\\.${sourceExtension}$`),
    (_match, extension: string) => `.test.${extension}`
  );
}
export function runtimePathForColocatedTest(path: string): string | undefined {
  const runtimePath = path.replace(
    new RegExp(`\\.test\\.${sourceExtension}$`),
    (_match, extension: string) => `.${extension}`
  );
  return runtimePath === path ? undefined : runtimePath;
}
