import ts from '@typescript/typescript6';
import { parseEventPipelineTypeScriptSource } from '../../src/lib/events/event-pipeline-typescript-source';
import { analyticsDeliveryModuleGraph as moduleGraph } from './analytics-delivery-module-graph';
import { serviceRoleCredentialAuthority } from './event-pipeline-service-role-credential-analysis';

const ENV_PATH = 'apps/web/src/env.ts';
// Public, non-secret env accessors. Importing ONLY these from env.ts confers no
// credential authority, so such an import edge is not a service-role authority
// edge. `getAppUrl` reads only NEXT_PUBLIC_APP_URL (a public value with a
// localhost fallback), exactly like the Supabase public URL/anon-key getters —
// it must not drag every tracking-helper consumer (e.g. the checkout page,
// which imports it transitively via server-side-analytics) into the frozen
// authority closure. Secret accessors like getSupabaseServiceRoleKey are
// deliberately absent, so any import that also pulls one still fails closed.
const SAFE_ENV_BINDINGS = new Set([
  'getAppUrl',
  'getJumiaEnvironment',
  'getSupabaseAnonKey',
  'getSupabaseUrl',
]);

function exportedCredentialBindings(
  path: string,
  source: string
): Set<string> | undefined {
  const file = parseEventPipelineTypeScriptSource(path, source);
  const hasExportModifier = (statement: ts.Statement): boolean =>
    Boolean(
      ts
        .getModifiers(statement as ts.HasModifiers)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    );
  const bindingNames = (name: ts.BindingName): string[] =>
    ts.isIdentifier(name)
      ? [name.text]
      : name.elements.flatMap((element) =>
          ts.isOmittedExpression(element) ? [] : bindingNames(element.name)
        );
  const declarationName = (statement: ts.Statement): string | undefined =>
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
      ? statement.name?.text
      : undefined;
  const names = new Set<string>();
  const locals = new Map<string, boolean>();
  const reads = (node: ts.Node) =>
    serviceRoleCredentialAuthority.readsCredential(path, node.getText(file));
  for (const statement of file.statements) {
    const exported = hasExportModifier(statement);
    const name = declarationName(statement);
    if (name) {
      const privileged = reads(statement);
      locals.set(name, privileged);
      if (exported && privileged) names.add(name);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const privileged = reads(declaration);
        for (const binding of bindingNames(declaration.name)) {
          locals.set(binding, privileged);
          if (exported && privileged) names.add(binding);
        }
      }
    }
  }
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (!clause || ts.isNamespaceExport(clause)) return undefined;
      const elements = clause.elements.filter((element) => !element.isTypeOnly);
      if (elements.length === 0) continue;
      if (statement.moduleSpecifier) return undefined;
      for (const element of elements) {
        const local = element.propertyName?.text ?? element.name.text;
        if (!locals.has(local)) return undefined;
        if (locals.get(local)) names.add(element.name.text);
      }
    } else if (
      ts.isExportAssignment(statement) &&
      reads(statement.expression)
    ) {
      return undefined;
    }
  }
  return names;
}

function runtimeReferenceBindings(
  statement: ts.ImportDeclaration | ts.ExportDeclaration
): string[] | undefined {
  if (ts.isExportDeclaration(statement) && statement.isTypeOnly) return [];
  const clause = ts.isImportDeclaration(statement)
    ? statement.importClause
    : statement.exportClause;
  if (!clause) return undefined;
  if (ts.isImportClause(clause)) {
    if (clause.isTypeOnly) return [];
    if (
      clause.name ||
      !clause.namedBindings ||
      ts.isNamespaceImport(clause.namedBindings)
    ) {
      return undefined;
    }
    if (clause.namedBindings.elements.length === 0) return undefined;
    return clause.namedBindings.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => element.propertyName?.text ?? element.name.text);
  }
  if (ts.isNamespaceExport(clause)) return undefined;
  if (clause.elements.length === 0) return undefined;
  return clause.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => element.propertyName?.text ?? element.name.text);
}

function edgeIsRelevant(
  importer: string,
  target: string,
  sources: ReadonlyMap<string, string>
): boolean {
  const source = sources.get(importer);
  const targetSource = sources.get(target);
  if (!source || !targetSource) return false;
  const privileged = exportedCredentialBindings(target, targetSource);
  const file = parseEventPipelineTypeScriptSource(importer, source);
  let examined = false;
  for (const statement of file.statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      moduleGraph.resolveLocalModule(
        importer,
        statement.moduleSpecifier.text,
        sources
      ) === target
    ) {
      examined = true;
      const bindings = runtimeReferenceBindings(statement);
      if (!bindings) return true;
      if (bindings.length === 0) continue;
      if (target === ENV_PATH) {
        if (bindings.some((binding) => !SAFE_ENV_BINDINGS.has(binding))) {
          return true;
        }
        continue;
      }
      if (!privileged || privileged.size === 0) return true;
      if (bindings.some((binding) => privileged.has(binding))) return true;
    }
  }
  return !examined;
}

export const eventPipelineCredentialImportAnalysis = {
  edgeIsRelevant,
} as const;
