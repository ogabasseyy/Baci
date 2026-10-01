import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as TypeScript from '@typescript/typescript6';

const appRequire = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../../package.json')
);
const ts = appRequire('@typescript/typescript6') as typeof TypeScript;

const HTTP_METHOD_ORDER = [
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
] as const;

type HttpMethod = (typeof HTTP_METHOD_ORDER)[number];

function isHttpMethod(value: string): value is HttpMethod {
  return HTTP_METHOD_ORDER.some((method) => method === value);
}

function isExported(node: TypeScript.Node) {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).some(
        ({ kind }) => kind === ts.SyntaxKind.ExportKeyword
      )
    : false;
}

function isDefaultExport(node: TypeScript.Node) {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).some(
        ({ kind }) => kind === ts.SyntaxKind.DefaultKeyword
      )
    : false;
}

/** Extracts the public HTTP exports of a Next route handler source file. */
export function extractStorefrontRouteMethods(
  source: string,
  options: Readonly<{ includeAutomaticOptions?: boolean }> = {}
) {
  const exported = new Set<HttpMethod>();
  const sourceFile = ts.createSourceFile(
    'route.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      isExported(statement) &&
      !isDefaultExport(statement) &&
      statement.name &&
      isHttpMethod(statement.name.text)
    ) {
      exported.add(statement.name.text);
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          isHttpMethod(declaration.name.text)
        )
          exported.add(declaration.name.text);
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly && isHttpMethod(element.name.text))
          exported.add(element.name.text);
      }
    }
  }
  if (exported.has('GET')) exported.add('HEAD');
  if (options.includeAutomaticOptions && exported.size > 0)
    exported.add('OPTIONS');
  return HTTP_METHOD_ORDER.filter((method) => exported.has(method));
}
