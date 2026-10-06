import ts from '@typescript/typescript6';
import { analyticsDeliveryAuthorityManifest as manifest } from './analytics-delivery-authority-manifest';
import { analyticsDeliveryAuthoritySourceGuards as sourceGuards } from './analytics-delivery-authority-source-guards';
import { analyticsDeliveryModuleGraph as moduleGraph } from './analytics-delivery-module-graph';
import { resolveLexicalString } from './analytics-delivery-static-string';

const adminSpecifier = '@/lib/supabase/admin';
const configPath =
  'apps/web/src/lib/analytics/fetch-analytics-platform-config.ts';
const privilegedClientModules = new Set([
  adminSpecifier,
  '@/lib/supabase/server',
  '@/lib/supabase/service',
  '@supabase/supabase-js',
]);
const privilegedClientPaths = new Set([
  'apps/web/src/lib/supabase/admin.ts',
  'apps/web/src/lib/supabase/server.ts',
  'apps/web/src/lib/supabase/service.ts',
]);

function ast(path: string, source: string) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function fromCall(expression: ts.Expression): ts.CallExpression | undefined {
  if (!ts.isCallExpression(expression)) return undefined;
  if (
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === 'from'
  ) {
    return expression;
  }
  return ts.isPropertyAccessExpression(expression.expression)
    ? fromCall(expression.expression.expression)
    : undefined;
}

function exactAccesses(path: string, source: string): string[] {
  const accesses: string[] = [];
  const file = ast(path, source);
  let adminCount = 0;
  let fromCount = 0;
  let selectCount = 0;
  const directCall = (node: ts.PropertyAccessExpression) =>
    ts.isCallExpression(node.parent) && node.parent.expression === node;
  const loader = file.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'fetchAnalyticsPlatformConfig'
  );
  const firstParameter = loader?.parameters[0];
  const clientName =
    firstParameter && ts.isIdentifier(firstParameter.name)
      ? firstParameter.name.text
      : undefined;
  if (path === configPath && !clientName) {
    accesses.push('__missing_injected_client__');
  }
  if (sourceGuards.readsCredentialEnvironment(path, source)) {
    accesses.push('__credential_environment__');
  }
  const sourcesForResolution = new Map([
    [path, source],
    ...[...privilegedClientPaths].map((candidate) => [candidate, ''] as const),
  ]);
  for (const specifier of moduleGraph.moduleReferences(path, source)) {
    const resolved = moduleGraph.resolveLocalModule(
      path,
      specifier,
      sourcesForResolution
    );
    const privileged =
      privilegedClientModules.has(specifier) ||
      Boolean(resolved && privilegedClientPaths.has(resolved));
    const exactPlatformAdmin =
      path === manifest.retiredPlatformAuthority.helper &&
      specifier === adminSpecifier;
    if (privileged && !exactPlatformAdmin) {
      accesses.push('__invalid_privileged_import__');
    }
  }
  if (path === manifest.retiredPlatformAuthority.helper) {
    const adminImports = file.statements.filter(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === adminSpecifier
    );
    const edge = adminImports[0] as ts.ImportDeclaration | undefined;
    const bindings = edge?.importClause?.namedBindings;
    if (
      adminImports.length !== 1 ||
      edge?.importClause?.name ||
      edge?.importClause?.isTypeOnly ||
      !bindings ||
      !ts.isNamedImports(bindings) ||
      bindings.elements.length !== 1 ||
      bindings.elements[0].name.text !== 'createAdminClient' ||
      bindings.elements[0].propertyName
    ) {
      accesses.push('__invalid_admin_import__');
    }
  }
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      privilegedClientModules.has(node.arguments[0].text)
    ) {
      accesses.push('__invalid_privileged_import__');
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      sourceGuards.identifierResolvesToNamedImport(
        node.expression,
        adminSpecifier,
        'createAdminClient'
      )
    ) {
      adminCount += 1;
      const parent = node.parent;
      const feedsFrom =
        ts.isPropertyAccessExpression(parent) &&
        parent.name.text === 'from' &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent;
      if (
        node.expression.text !== 'createAdminClient' ||
        node.arguments.length !== 1 ||
        resolveLexicalString(node.arguments[0], file, node) !==
          'event-pipeline' ||
        !feedsFrom
      ) {
        accesses.push('__invalid_admin_construction__');
      }
    }
    if (
      path === configPath &&
      clientName &&
      ts.isIdentifier(node) &&
      node.text === clientName
    ) {
      const declaration =
        ts.isParameter(node.parent) && node.parent.name === node;
      const from =
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.expression === node &&
        node.parent.name.text === 'from' &&
        directCall(node.parent);
      if (!declaration && !from) accesses.push('__forbidden_client_surface__');
    }
    if (ts.isPropertyAccessExpression(node)) {
      const operation = node.name.text;
      if (['delete', 'insert', 'rpc', 'update', 'upsert'].includes(operation)) {
        accesses.push(`__forbidden_${operation}__`);
      }
      if (['from', 'select'].includes(operation) && !directCall(node)) {
        accesses.push(`__aliased_${operation}__`);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'from'
    ) {
      fromCount += 1;
      if (!resolveLexicalString(node.arguments[0], file, node)) {
        accesses.push('__unresolved_from__');
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'select'
    ) {
      selectCount += 1;
      const from = fromCall(node.expression.expression);
      const table = from && resolveLexicalString(from.arguments[0], file, node);
      const projection = resolveLexicalString(node.arguments[0], file, node);
      accesses.push(
        table && projection ? `${table}|${projection}` : '__unresolved_select__'
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (fromCount !== selectCount) accesses.push('__unpaired_from__');
  if (path === manifest.retiredPlatformAuthority.helper && adminCount !== 1) {
    accesses.push('__invalid_admin_count__');
  }
  return accesses.sort();
}

export function analyzeCredentialProjectionSets(
  sources: ReadonlyMap<string, string>
): string[] {
  const expected = new Map<string, string[]>([
    [
      configPath,
      [
        `merchants|${manifest.credentialProjections.merchantEntitlement}`,
        `merchants|${manifest.credentialProjections.merchantProviderConfig}`,
        `merchant_feature_settings|${manifest.credentialProjections.merchantFeatureProviderConfig}`,
      ],
    ],
    [
      manifest.retiredPlatformAuthority.helper,
      [
        `platform_settings|${manifest.credentialProjections.platformProviderConfig}`,
      ],
    ],
  ]);
  const findings: string[] = [];
  for (const [path, expectedSelects] of expected) {
    if (!sources.has(path)) continue;
    const actual = exactAccesses(path, sources.get(path) ?? '');
    if (actual.join('\n') !== [...expectedSelects].sort().join('\n')) {
      findings.push(`${path}: exact credential projection set drift`);
    }
  }
  return findings;
}
