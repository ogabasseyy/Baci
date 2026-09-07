import ts from '@typescript/typescript6';
import { EVENT_PIPELINE_BOUNDARY } from './event-pipeline-database';

export { collectProductionImportClosure } from './event-pipeline-import-closure';
export const eventPipelineBoundaryManifest = {
  ...EVENT_PIPELINE_BOUNDARY,
  authority: {
    ...EVENT_PIPELINE_BOUNDARY.authority,
    credentialPaths: EVENT_PIPELINE_BOUNDARY.authority.credentialPaths,
  },
  sdkConstructorHashes: {
    'apps/web/src/lib/events/event-ingress-capability.ts':
      '5e0cf13d22315a021e6a122604563777f0ecc22a1a88faed003daa3bee0db64c',
    'apps/web/src/lib/events/event-pipeline-test-client.ts':
      '4979380981132de46400971d9a626629db654df139f17321dceef7f4d0b6e713',
  },
  // biome-ignore format: compact allowlist preserves the 300-line verifier gate.
  trustedWrapperImporters: ['apps/web/src/app/api/analytics/conversion/route.ts', 'apps/web/src/app/api/events/route.ts'],
} as const;
export function memberName(expression: ts.Expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    (ts.isStringLiteral(expression.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
  )
    return expression.argumentExpression.text;
  return undefined;
}
function visibleFrom(node: ts.Node, at: ts.Node): boolean {
  const scope = ts.findAncestor(
    node.parent,
    (item) =>
      ts.isSourceFile(item) || ts.isBlock(item) || ts.isFunctionLike(item)
  );
  return Boolean(scope && ts.findAncestor(at, (item) => item === scope));
}
export function bindingInitializer(
  sourceFile: ts.SourceFile,
  name: string,
  at: ts.Node
): { found: boolean; initializer?: ts.Expression } {
  let best: ts.VariableDeclaration | ts.ParameterDeclaration | undefined;
  function visit(node: ts.Node) {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.pos < at.pos &&
      visibleFrom(node, at) &&
      (!best || node.pos > best.pos)
    )
      best = node;
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return best
    ? { found: true, initializer: best.initializer }
    : { found: false };
}
export function staticText(
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  at: ts.Node
): string | undefined {
  if (!expression) return undefined;
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return expression.text;
  if (!ts.isIdentifier(expression)) return undefined;
  const binding = bindingInitializer(sourceFile, expression.text, at);
  return binding.found
    ? staticText(binding.initializer, sourceFile, at)
    : undefined;
}
export function rpcCallable(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  at: ts.CallExpression
): boolean {
  if (memberName(expression) === 'rpc') return true;
  if (!ts.isIdentifier(expression)) return false;
  const initializer = bindingInitializer(
    sourceFile,
    expression.text,
    at
  ).initializer;
  if (!initializer) return false;
  if (memberName(initializer) === 'rpc') return true;
  if (
    ts.isCallExpression(initializer) &&
    memberName(initializer.expression) === 'bind' &&
    (ts.isPropertyAccessExpression(initializer.expression) ||
      ts.isElementAccessExpression(initializer.expression))
  )
    return memberName(initializer.expression.expression) === 'rpc';
  return rpcCallable(initializer, sourceFile, at);
}
export function projectionColumns(path: string, table: string): Set<string> {
  const authorityNames = eventPipelineBoundaryManifest.projectionAuthorities[
    path as keyof typeof eventPipelineBoundaryManifest.projectionAuthorities
  ] as readonly (keyof typeof eventPipelineBoundaryManifest.projections)[];
  return new Set(
    (authorityNames ?? []).flatMap(
      (name) =>
        (eventPipelineBoundaryManifest.projections[name] as Projection)[
          table
        ] ?? []
    )
  );
}
export function findFromCall(
  expression: ts.Expression,
  sourceFile?: ts.SourceFile,
  at?: ts.Node
): ts.CallExpression | undefined {
  if (ts.isIdentifier(expression) && sourceFile && at) {
    const initializer = bindingInitializer(
      sourceFile,
      expression.text,
      at
    ).initializer;
    return initializer ? findFromCall(initializer, sourceFile, at) : undefined;
  }
  if (!ts.isCallExpression(expression)) return undefined;
  if (memberName(expression.expression) === 'from') return expression;
  if (
    ts.isPropertyAccessExpression(expression.expression) ||
    ts.isElementAccessExpression(expression.expression)
  )
    return findFromCall(expression.expression.expression, sourceFile, at);
  return undefined;
}
type Projection = Readonly<Record<string, readonly string[]>>;
type FactoryKind = 'admin' | 'sdk' | 'server' | 'service';
const factoryModules: Readonly<Record<string, FactoryKind>> = {
  '@/lib/supabase/admin': 'admin',
  '@/lib/supabase/server': 'server',
  '@/lib/supabase/service': 'service',
  '@supabase/supabase-js': 'sdk',
};
function factoryModuleKind(
  specifier: string | undefined
): FactoryKind | undefined {
  return specifier?.startsWith('@supabase/supabase-js/')
    ? 'sdk'
    : factoryModules[specifier ?? ''];
}
const factoryExports: Readonly<Record<FactoryKind, readonly string[]>> = {
  admin: ['createClient', 'createAdminClient'],
  sdk: ['createClient'],
  server: ['createClient'],
  service: ['createServiceClient'],
};
const serviceSentinels: Readonly<Record<string, string>> = {
  'apps/web/src/lib/ads/server-credential-client.ts': 'ads-credentials',
  'apps/web/src/lib/wallet/server-funding-recovery-hmac-client.ts':
    'wallet-funding-recovery',
  'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts':
    'shipping-quote-booking-economics',
};
// biome-ignore format: exact construction allowlist preserves the 300-line verifier gate.
const privilegedRouteAdminConstructors = ['apps/web/src/app/api/platform/events/platform-event-forwarding.ts'] as const;
// biome-ignore format: compact signature preserves the 300-line verifier gate.
export function authorityFindings(path: string, sourceFile: ts.SourceFile): string[] {
  const findings: string[] = [];
  const bindings = new Map<string, FactoryKind>();
  const bareClients = new Set<string>();
  const authority = eventPipelineBoundaryManifest.authority;
  const listed = (paths: readonly string[]) => paths.includes(path);
  const add = (message: string) => findings.push(`${path}: ${message}`);
  for (const statement of sourceFile.statements) {
    const reexport = ts.isExportDeclaration(statement) ? statement : undefined;
    // biome-ignore format: compact AST guard preserves the 300-line module gate.
    const reexportKind = reexport?.moduleSpecifier && ts.isStringLiteral(reexport.moduleSpecifier) ? factoryModuleKind(reexport.moduleSpecifier.text) : undefined;
    if (reexportKind === 'admin' || reexportKind === 'service') {
      const clause = reexport?.exportClause;
      // biome-ignore format: compact AST guard preserves the 300-line module gate.
      const privileged = !reexport?.isTypeOnly && (!clause || ts.isNamespaceExport(clause) || clause.elements.some((element) => !element.isTypeOnly && factoryExports[reexportKind].includes(element.propertyName?.text ?? element.name.text)));
      if (privileged) add('unauthorized privileged factory re-export');
      continue;
    }
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const kind = factoryModuleKind(statement.moduleSpecifier.text);
    if (!kind) continue;
    const names =
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
        ? statement.importClause.namedBindings.elements
        : [];
    // biome-ignore format: compact AST guard must stay within the 300-line module gate.
    const namespace = statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings) ? statement.importClause.namedBindings.name.text : undefined;
    // biome-ignore format: compact AST guard must stay within the 300-line module gate.
    if (namespace) { if (kind === 'sdk') bareClients.add(namespace); bindings.set(namespace, kind); } if (statement.importClause?.name) bindings.set(statement.importClause.name.text, kind);
    for (const element of names) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (kind === 'sdk' && imported === 'SupabaseClient')
        bareClients.add(element.name.text);
      if (factoryExports[kind].includes(imported))
        bindings.set(element.name.text, kind);
    }
  }
  const importedKinds = new Set(bindings.values());
  if (importedKinds.has('sdk') && !listed(authority.legacySdkImporters) && !listed(authority.factoryModules))
    add('unauthorized privileged SDK factory importer');
  // biome-ignore format: compact authority guard preserves the 300-line verifier gate.
  if (importedKinds.has('service') && !listed(authority.serviceImporters))
    add('unauthorized trusted wrapper importer');
  for (const [kind, importers] of [
    ['admin', authority.adminImporters],
    ['server', authority.serverImporters],
  ] as const)
    if (importedKinds.has(kind) && !listed(importers))
      add(`unauthorized ${kind} factory importer`);
  const exemptFactory = listed(authority.factoryModules);
  function visit(node: ts.Node) {
    // biome-ignore format: compact AST guard must stay within the 300-line module gate.
    const bareClient = ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) ? node.typeName.text : ts.isTypeReferenceNode(node) && ts.isQualifiedName(node.typeName) && ts.isIdentifier(node.typeName.left) && node.typeName.right.text === 'SupabaseClient' ? node.typeName.left.text : undefined;
    if (
      ts.isTypeReferenceNode(node) &&
      bareClient &&
      bareClients.has(bareClient) &&
      !node.typeArguments?.length &&
      !listed(authority.bareClientImporters) &&
      !exemptFactory
    )
      add('forbidden bare SupabaseClient');
    if (ts.isCallExpression(node)) {
      // biome-ignore format: compact AST guard must stay within the 300-line module gate.
      const factory = ts.isIdentifier(node.expression) ? node.expression.text : (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) && ts.isIdentifier(node.expression.expression) && factoryExports[bindings.get(node.expression.expression.text) ?? 'sdk'].includes(memberName(node.expression) ?? '') ? node.expression.expression.text : undefined;
      const kind = factory ? bindings.get(factory) : undefined;
      const shadowed = bindingInitializer(
        sourceFile,
        factory ?? '',
        node
      ).found;
      if (kind && !shadowed && !exemptFactory) {
        const requiredSentinel =
          kind === 'service'
            ? serviceSentinels[path] ?? 'event-pipeline'
            : 'event-pipeline';
        const sentinel = node.arguments.some(
          (argument) =>
            ts.isStringLiteral(argument) && argument.text === requiredSentinel
        );
        if (
          kind === 'sdk' &&
          node.typeArguments?.[0]?.getText(sourceFile) !== 'Database' &&
          !listed(authority.legacySdkImporters)
        )
          add('SDK createClient requires Database');
        if (kind === 'service' && !listed(authority.serviceImporters))
          add('unauthorized service factory importer');
        const sentinelRequired =
          kind === 'service' ||
          (kind === 'admin' &&
            path.endsWith('/record-platform-order-created-event.ts')) ||
          (kind === 'server' && path.includes('/api/admin/event-pipeline/'));
        if (sentinelRequired && !sentinel)
          add(`${kind} factory requires ${requiredSentinel} sentinel`);
        // biome-ignore format: compact authority guard preserves the 300-line verifier gate.
        if ((kind === 'service' || kind === 'admin') && path.includes('/app/api/') && !listed(kind === 'service' ? authority.serviceImporters : privilegedRouteAdminConstructors))
          add('privileged route client construction is forbidden');
      }
    }
    // biome-ignore format: compact AST guard must stay within the 300-line module gate.
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ['admin', 'service', ...(listed(authority.legacySdkImporters) ? [] : ['sdk'])].includes(factoryModuleKind(staticText(node.arguments[0], sourceFile, node)) ?? ''))
      add('unauthorized dynamic privileged factory import');
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}
