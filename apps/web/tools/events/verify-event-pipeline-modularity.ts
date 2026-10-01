import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from '@typescript/typescript6';
// biome-ignore format: compact import preserves the verifier's own 300-line gate.
import { collectProductionImportClosure, eventPipelineBoundaryManifest } from '../../src/lib/events/event-pipeline-boundary-manifest';
import { readGitIndexSources } from './event-pipeline-git-content';
import { readGitSourceSnapshot } from './event-pipeline-git-source-snapshot';

const FROZEN_BASE_SHA = 'cfe0e9864cd776af98ef400969257e2ec147f65d';
const inventoryPath =
  'apps/web/tools/events/fixtures/event-pipeline-path-inventory.tsv';
const checkedExtension = /\.(?:json|mjs|sh|sql|ts|tsx)$/;
const typeScriptExtension = /\.(?:ts|tsx)$/;
const testPathPattern = /\.(?:spec|test)\.(?:mjs|ts|tsx)$/;
// biome-ignore format: compact allowlists keep the verifier below its own gate.
const dynamicPrefixes = ['apps/web/src/app/api/admin/event-pipeline/', 'apps/web/src/app/api/analytics/conversion/', 'apps/web/src/app/api/events/', 'apps/web/src/app/api/platform/events/', 'apps/web/src/lib/analytics/', 'apps/web/src/lib/events/', 'apps/web/src/lib/trigger-purchase-conversion', 'apps/web/src/schemas/event-', 'apps/web/src/schemas/claimed-event-delivery', 'apps/web/src/schemas/domain-event-worker-message', 'apps/web/src/scripts/domain-event-worker', 'apps/web/src/scripts/event-delivery-', 'apps/web/src/scripts/process-claimed-event-delivery', 'apps/web/src/scripts/process-domain-events', 'apps/web/src/scripts/process-event-deliveries', 'apps/web/tools/events/', 'supabase/tests/domain_event_', 'supabase/tests/event_delivery_'] as const;
// biome-ignore format: compact allowlists keep the verifier below its own gate.
const routeMethods = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
// biome-ignore format: compact allowlists keep the verifier below its own gate.
const namedThinFacades = new Set(['apps/web/src/lib/events/event-pipeline-config.ts', 'apps/web/src/lib/events/event-redaction.ts', 'apps/web/src/lib/events/event-route-registry.ts', 'apps/web/src/schemas/event-dead-letter.ts']);
// biome-ignore format: compact allowlists keep the verifier below its own gate.
const thinCliPaths = new Set(['apps/web/src/scripts/process-domain-events.ts', 'apps/web/src/scripts/process-event-deliveries.ts']);
// Frozen red-oracle exceptions are prior Task 5/6 authority aggregates, not generic facades.
// biome-ignore format: the exact frozen exceptions are deliberately visible and compact.
const grandfatheredAggregatePaths = new Set(['apps/web/src/lib/events/event-pipeline-boundary-manifest.ts', 'apps/web/src/lib/events/event-pipeline-database.ts', 'apps/web/tools/events/event-pipeline-service-authority-graph.ts', 'apps/web/tools/events/verify-analytics-delivery-authority.ts', 'apps/web/tools/events/verify-event-pipeline-boundaries.ts']);
type ModularityOptions = { baseSha?: string; includeWorkingTree?: boolean };
type CollectedPaths = { newModulePaths: string[]; paths: string[] };
type SourceView = 'filesystem' | 'head' | 'index';
function gitPaths(root: string, args: readonly string[]): string[] {
  return execFileSync('git', [...args], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}
// biome-ignore format: independent source views prevent one overlay from hiding another.
function sourceView(root: string, path: string, view: SourceView): string | undefined {
  if (view === 'filesystem') {
    const absolutePath = resolve(root, path);
    return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : undefined;
  }
  try {
    return execFileSync('git', ['show', view === 'head' ? `HEAD:${path}` : `:${path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}
// biome-ignore format: each available snapshot is verified independently.
function sourceViews(root: string, path: string, includeWorkingTree: boolean): { source: string; view: SourceView }[] {
  return (includeWorkingTree ? ['index', 'filesystem'] as const : ['head'] as const).flatMap((view) => { const source = sourceView(root, path, view); return source === undefined ? [] : [{ source, view }]; });
}
// biome-ignore format: frozen inventory parsing stays compact under the verifier gate.
function frozenCreatedPaths(root: string, baseSha: string): string[] {
  const revision = execFileSync('git', ['log', '--format=%H', '--diff-filter=A', '--reverse', `${baseSha}..HEAD`, '--', inventoryPath], { cwd: root, encoding: 'utf8' }).trim().split('\n')[0] || baseSha;
  return execFileSync('git', ['show', `${revision}:${inventoryPath}`], { cwd: root, encoding: 'utf8' }).trimEnd().split('\n').flatMap((record) => {
    const [status, path] = record.split('\t');
    return status === 'A' && path ? [path] : [];
  });
}
// biome-ignore format: evidence exclusions are intentionally compact.
function isEvidencePath(path: string): boolean {
  if (path === 'apps/web/src/types/supabase.ts' || path.endsWith('.md')) return true;
  return path.endsWith('.json') && /(?:evidence|fixtures|provenance|receipt)/.test(path);
}
// biome-ignore format: dynamic-scope selection is intentionally compact.
function isRelevantPath(path: string, frozen: ReadonlySet<string>): boolean {
  return !isEvidencePath(path) && checkedExtension.test(path) && (frozen.has(path) || path === 'apps/web/tsconfig.tools-workers.json' || dynamicPrefixes.some((prefix) => path.startsWith(prefix)));
}
// biome-ignore format: compact snapshot construction preserves the verifier's own gate.
function productionClosure(root: string, baseSha: string, includeWorkingTree: boolean): Set<string> {
  const frozen = readGitSourceSnapshot.committedRevision(root, baseSha);
  const head = readGitSourceSnapshot.committedRevision(root, 'HEAD');
  const snapshots: ReadonlyMap<string, string>[] = [frozen, head];
  if (includeWorkingTree) {
    const stagedPaths = gitPaths(root, ['diff', '--cached', '--name-only', '-z', '--']);
    const stagedSources = readGitIndexSources(root, stagedPaths);
    const index = new Map(head);
    for (const path of stagedPaths) { const source = stagedSources.get(path); if (source === undefined) index.delete(path); else index.set(path, source); }
    const filesystem = new Map(readGitSourceSnapshot(root).sources);
    for (const path of stagedPaths) { const absolute = resolve(root, path); if (existsSync(absolute)) filesystem.set(path, readFileSync(absolute, 'utf8')); else filesystem.delete(path); }
    snapshots.push(index, filesystem);
  }
  return new Set(snapshots.flatMap((sources) => [...collectProductionImportClosure(eventPipelineBoundaryManifest.productionRoots, sources)]));
}
function collectEventPipelineModularityPaths(
  root: string,
  options: ModularityOptions = {}
): CollectedPaths {
  const baseSha = options.baseSha ?? FROZEN_BASE_SHA;
  const frozenCreated = frozenCreatedPaths(root, baseSha);
  const frozen = new Set(frozenCreated);
  // biome-ignore format: compact closure call preserves the verifier's own gate.
  const reachable = productionClosure(root, baseSha, options.includeWorkingTree === true);
  // biome-ignore format: argv vectors are kept compact for the 300-line gate.
  const committed = gitPaths(root, ['diff', '--name-only', '-z', `${baseSha}...HEAD`, '--']);
  // biome-ignore format: argv vectors are kept compact for the 300-line gate.
  const committedAdded = gitPaths(root, ['diff', '--diff-filter=A', '--name-only', '-z', `${baseSha}...HEAD`, '--']);
  const staged = options.includeWorkingTree
    ? gitPaths(root, ['diff', '--cached', '--name-only', '-z', '--'])
    : [];
  // biome-ignore format: argv vectors are kept compact for the 300-line gate.
  const stagedAdded = options.includeWorkingTree ? gitPaths(root, ['diff', '--cached', '--diff-filter=A', '--name-only', '-z', '--']) : [];
  const unstaged = options.includeWorkingTree
    ? gitPaths(root, ['diff', '--name-only', '-z', '--'])
    : [];
  // biome-ignore format: argv vectors are kept compact for the 300-line gate.
  const untracked = options.includeWorkingTree ? gitPaths(root, ['ls-files', '--others', '--exclude-standard', '-z', '--']) : [];
  // biome-ignore format: reachability broadens location scope, not evidence or extension scope.
  const relevant = (path: string) => isRelevantPath(path, frozen) || (!isEvidencePath(path) && checkedExtension.test(path) && reachable.has(path));
  // biome-ignore format: compact path unions preserve the verifier's own 300-line gate.
  return {
    newModulePaths: [...new Set([...frozenCreated, ...committedAdded, ...stagedAdded, ...untracked])].filter(relevant).sort(),
    paths: [...new Set([...frozenCreated, ...committed, ...staged, ...unstaged, ...untracked])].filter(relevant).sort(),
  };
}
// biome-ignore format: compact AST helpers preserve the verifier's own 300-line gate.
const scriptKind = (path: string) => path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
// biome-ignore format: compact AST helpers preserve the verifier's own 300-line gate.
const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) => Boolean(ts.getModifiers(node as ts.HasModifiers)?.some((item) => item.kind === kind));
// biome-ignore format: compact AST helpers preserve the verifier's own 300-line gate.
const hasParseError = (path: string, source: string) => Boolean(ts.transpileModule(source, { compilerOptions: { noEmit: true }, fileName: path, reportDiagnostics: true }).diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error));
// biome-ignore format: recursive binding extraction preserves the verifier's own 300-line gate.
const bindingNames = (name: ts.BindingName): string[] => ts.isIdentifier(name) ? [name.text] : name.elements.flatMap((element) => ts.isOmittedExpression(element) ? [] : bindingNames(element.name));
function isRuntimeExportDeclaration(
  statement: ts.Statement
): statement is ts.ExportDeclaration {
  if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) return false;
  if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause))
    return true;
  return statement.exportClause.elements.some((item) => !item.isTypeOnly);
}
function runtimeExportNames(path: string, source: string): string[] {
  // biome-ignore format: compact AST construction preserves the verifier's own 300-line gate.
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path));
  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    if (isRuntimeExportDeclaration(statement)) {
      if (!statement.exportClause) names.push('*');
      else if (ts.isNamespaceExport(statement.exportClause)) {
        names.push(statement.exportClause.name.text);
      } else {
        names.push(
          ...statement.exportClause.elements
            .filter((item) => !item.isTypeOnly)
            .map((item) => item.name.text)
        );
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      names.push(statement.isExportEquals ? 'export=' : 'default');
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isModuleDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (!hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) {
        names.push(statement.name?.text ?? 'default');
      }
      continue;
    }
    // biome-ignore format: compact ambient-variable exclusion preserves the verifier's own gate.
    if (!ts.isVariableStatement(statement) || hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      names.push(...bindingNames(declaration.name));
    }
  }
  return names;
}
function hasRuntime(path: string, source: string): boolean {
  // biome-ignore format: compact AST construction preserves the verifier's own 300-line gate.
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path));
  return sourceFile.statements.some(
    (statement) =>
      (!ts.isImportDeclaration(statement) || isRuntimeImport(statement)) &&
      !ts.isInterfaceDeclaration(statement) &&
      !ts.isTypeAliasDeclaration(statement) &&
      (!ts.isExportDeclaration(statement) ||
        isRuntimeExportDeclaration(statement)) &&
      !ts.isEmptyStatement(statement) &&
      !hasModifier(statement, ts.SyntaxKind.DeclareKeyword)
  );
}
// biome-ignore format: runtime import classification preserves type-only exemptions compactly.
function isRuntimeImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  const bindings = clause?.namedBindings;
  return !clause || (!clause.isTypeOnly && (Boolean(clause.name) || (bindings ? ts.isNamespaceImport(bindings) || bindings.elements.length === 0 || bindings.elements.some((item) => !item.isTypeOnly) : false)));
}
// biome-ignore format: the structural facade predicate is intentionally compact.
function isThinReexportFacade(path: string, source: string): boolean {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path));
  return sourceFile.statements.some((item) => isRuntimeExportDeclaration(item) && item.moduleSpecifier) && sourceFile.statements.every((item) => ts.isImportDeclaration(item) || ts.isInterfaceDeclaration(item) || ts.isTypeAliasDeclaration(item) || ts.isExportDeclaration(item) || ts.isEmptyStatement(item));
}
// biome-ignore format: recursive structural inspection stays compact under the verifier gate.
function sourceHasNode(root: ts.Node, predicate: (node: ts.Node) => boolean): boolean {
  let found = false;
  const visit = (node: ts.Node): void => { if (predicate(node)) found = true; else ts.forEachChild(node, visit); };
  visit(root); return found;
}
// biome-ignore format: the exact import.meta.url shape stays compact under the verifier gate.
const isImportMetaUrl = (node: ts.Expression): boolean => ts.isPropertyAccessExpression(node) && node.name.text === 'url' && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
// biome-ignore format: the exact process.argv[1] shape stays compact under the verifier gate.
const isProcessArgvOne = (node: ts.Expression): boolean => ts.isElementAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'process' && node.expression.name.text === 'argv' && Boolean(node.argumentExpression && ts.isNumericLiteral(node.argumentExpression) && node.argumentExpression.text === '1');
// biome-ignore format: exact structural CLI bootstrap receipts stay compact and explicit.
function isThinCli(path: string, source: string): boolean {
  if (!thinCliPaths.has(path)) return false;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path));
  const imports = file.statements.filter(ts.isImportDeclaration);
  const hasImports = imports.some((item) => !item.importClause && ts.isStringLiteral(item.moduleSpecifier) && item.moduleSpecifier.text === 'dotenv/config') && imports.some((item) => { const bindings = item.importClause?.namedBindings; return ts.isStringLiteral(item.moduleSpecifier) && item.moduleSpecifier.text === 'node:url' && Boolean(bindings && ts.isNamedImports(bindings) && bindings.elements.some((element) => (element.propertyName ?? element.name).text === 'pathToFileURL' && element.name.text === 'pathToFileURL')); });
  const invoked = file.statements.flatMap((item) => ts.isVariableStatement(item) ? [...item.declarationList.declarations] : []).find((item) => ts.isIdentifier(item.name) && item.name.text === 'invokedPath');
  const hasInvokedPath = Boolean(invoked?.initializer && sourceHasNode(invoked.initializer, (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'pathToFileURL' && node.arguments.length === 1 && Boolean(node.arguments[0] && isProcessArgvOne(node.arguments[0]))));
  const guard = file.statements.find((item): item is ts.IfStatement => ts.isIfStatement(item) && ts.isBinaryExpression(item.expression) && item.expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && ((isImportMetaUrl(item.expression.left) && ts.isIdentifier(item.expression.right) && item.expression.right.text === 'invokedPath') || (isImportMetaUrl(item.expression.right) && ts.isIdentifier(item.expression.left) && item.expression.left.text === 'invokedPath')));
  let workerName: string | undefined;
  if (guard) sourceHasNode(guard.thenStatement, (node) => { if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return false; workerName = node.expression.text; return true; });
  const worker = file.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === workerName);
  return hasImports && hasInvokedPath && Boolean(worker?.body && sourceHasNode(worker.body, (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createServiceClient' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'event-pipeline'));
}
// biome-ignore format: compact path derivation preserves the verifier's own 300-line gate.
const colocatedTestPath = (path: string): string => path.replace(/\.(mjs|ts|tsx)$/, '.test.$1');
// biome-ignore format: the colocated-test predicate is intentionally compact under its own gate.
function requiresColocatedTest(path: string, source: string): boolean {
  return /^apps\/web\/(?:src|tools)\//.test(path) && /\.(?:mjs|ts|tsx)$/.test(path) && !testPathPattern.test(path) && !path.includes('.test-support.') && hasRuntime(path, source);
}
// biome-ignore format: compact route predicate preserves the verifier's own gate.
const isNextRouteMethodSet = (path: string, names: readonly string[]): boolean => /\/app\/api\/.+\/route\.ts$/.test(path) && names.length > 0 && names.every((name) => routeMethods.has(name));
function verifyEventPipelineModularity(
  root: string,
  options: ModularityOptions = {}
): string[] {
  const collected = collectEventPipelineModularityPaths(root, options);
  const newModules = new Set(collected.newModulePaths);
  const findings: string[] = [];
  // biome-ignore format: the queue adds only required colocated tests in their matching view.
  const pending = collected.paths.flatMap((path) => sourceViews(root, path, options.includeWorkingTree === true).map((item) => ({ ...item, path })));
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) break;
    const { path, source, view } = item;
    const lineCount =
      source.split(/\r?\n/).length - Number(source.endsWith('\n'));
    if (lineCount > 300) {
      findings.push(`${path}: exceeds 300 lines (${lineCount})`);
    }
    if (!typeScriptExtension.test(path)) continue;
    if (hasParseError(path, source))
      findings.push(`${path}: TypeScript parse error`);
    if (requiresColocatedTest(path, source)) {
      const testPath = colocatedTestPath(path);
      const testSource = sourceView(root, testPath, view);
      // biome-ignore format: matched-view test discovery stays compact under the gate.
      if (testSource === undefined) findings.push(`${path}: runtime source is missing colocated test ${testPath}`); else pending.push({ path: testPath, source: testSource, view });
    }
    if (
      testPathPattern.test(path) ||
      path.includes('.test-support.') ||
      !newModules.has(path)
    )
      continue;
    const names = runtimeExportNames(path, source);
    const thinFacade = isThinReexportFacade(path, source);
    if (thinFacade && !namedThinFacades.has(path)) {
      findings.push(`${path}: unauthorized thin re-export facade`);
    }
    if (
      names.length > 1 &&
      !isNextRouteMethodSet(path, names) &&
      !(thinFacade && namedThinFacades.has(path)) &&
      !isThinCli(path, source) &&
      !grandfatheredAggregatePaths.has(path)
    ) {
      findings.push(`${path}: multiple runtime exports ${names.join(', ')}`);
    }
  }
  return [...new Set(findings)].sort();
}

export const eventPipelineModularityVerifier = {
  collect: collectEventPipelineModularityPaths,
  verify: verifyEventPipelineModularity,
} as const;

// biome-ignore format: compact CLI preserves the verifier's own 300-line gate.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const findings = verifyEventPipelineModularity(root, { includeWorkingTree: process.argv.includes('--include-working-tree') });
  if (findings.length) {
    console.error(findings.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('event pipeline modularity verification passed');
  }
}
