import ts from '@typescript/typescript6';
import { parseEventPipelineTypeScriptSource } from '../../src/lib/events/event-pipeline-typescript-source';
import { analyticsDeliveryModuleGraph as moduleGraph } from './analytics-delivery-module-graph';
import { resolveLexicalModuleSpecifier } from './analytics-delivery-module-specifier';

type ModuleAnalysis = {
  references: readonly string[];
  reexports: readonly string[];
  useServer: boolean;
};

function unwrap(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrap(expression.expression);
  }
  return expression;
}

function referencesAlias(
  expression: ts.Expression,
  aliases: ReadonlySet<string>
): boolean {
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) return aliases.has(value.text);
  if (ts.isConditionalExpression(value)) {
    return (
      referencesAlias(value.whenTrue, aliases) ||
      referencesAlias(value.whenFalse, aliases)
    );
  }
  if (ts.isBinaryExpression(value)) {
    if (value.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return referencesAlias(value.right, aliases);
    }
    return (
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(value.operatorToken.kind) &&
      (referencesAlias(value.left, aliases) ||
        referencesAlias(value.right, aliases))
    );
  }
  if (!ts.isCallExpression(value)) return false;
  const callee = unwrap(value.expression);
  return (
    (ts.isPropertyAccessExpression(callee) ||
      ts.isElementAccessExpression(callee)) &&
    (ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ts.isStringLiteralLike(callee.argumentExpression)
        ? callee.argumentExpression.text
        : undefined) === 'bind' &&
    referencesAlias(callee.expression, aliases)
  );
}

function analyzeModule(path: string, source: string): ModuleAnalysis {
  const file = parseEventPipelineTypeScriptSource(path, source);
  const aliases = new Set(['require']);
  let changed = true;
  while (changed) {
    changed = false;
    const findAliases = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        referencesAlias(node.initializer, aliases) &&
        !aliases.has(node.name.text)
      ) {
        aliases.add(node.name.text);
        changed = true;
      }
      ts.forEachChild(node, findAliases);
    };
    findAliases(file);
  }
  const references = new Set<string>();
  const reexports = new Set<string>();
  const add = (
    expression: ts.Expression | undefined,
    at: ts.Node,
    reexport = false
  ) => {
    const specifier = resolveLexicalModuleSpecifier(expression, file, at);
    if (specifier === undefined) return;
    references.add(specifier);
    if (reexport) reexports.add(specifier);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      if (
        node.importClause?.name ||
        !bindings ||
        !ts.isNamedImports(bindings) ||
        bindings.elements.length === 0 ||
        bindings.elements.some((element) => !element.isTypeOnly)
      ) {
        add(node.moduleSpecifier, node);
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const runtime =
        !node.exportClause ||
        ts.isNamespaceExport(node.exportClause) ||
        node.exportClause.elements.length === 0 ||
        node.exportClause.elements.some((element) => !element.isTypeOnly);
      if (runtime) add(node.moduleSpecifier, node, true);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression, node);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        referencesAlias(node.expression, aliases))
    ) {
      add(node.arguments[0], node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  let useServer = false;
  for (const statement of file.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      break;
    }
    if (statement.expression.text === 'use server') useServer = true;
  }
  return {
    references: [...references],
    reexports: [...reexports],
    useServer,
  };
}

function create(sources: ReadonlyMap<string, string>) {
  const analyses = new Map<string, ModuleAnalysis>();
  const analysis = (path: string): ModuleAnalysis => {
    const cached = analyses.get(path);
    if (cached) return cached;
    const value = analyzeModule(path, sources.get(path) ?? '');
    analyses.set(path, value);
    return value;
  };
  const importTargetPaths = (
    root: string,
    targets: ReadonlySet<string>
  ): Map<string, string[][]> => {
    const pending: string[][] = [[root]];
    const visited = new Set<string>();
    const seenTargetEdges = new Set<string>();
    const paths = new Map<string, string[][]>();
    if (targets.has(root)) paths.set(root, [[root]]);
    while (pending.length > 0) {
      const path = pending.shift();
      const current = path?.at(-1);
      if (!path || !current || visited.has(current)) continue;
      visited.add(current);
      const currentAnalysis = analysis(current);
      const references =
        current !== root && currentAnalysis.useServer
          ? currentAnalysis.reexports
          : currentAnalysis.references;
      for (const specifier of references) {
        const target = moduleGraph.resolveLocalModule(
          current,
          specifier,
          sources
        );
        if (!target) continue;
        if (targets.has(target)) {
          const edge = JSON.stringify([current, target]);
          if (!seenTargetEdges.has(edge)) {
            seenTargetEdges.add(edge);
            const targetPaths = paths.get(target) ?? [];
            targetPaths.push([...path, target]);
            paths.set(target, targetPaths);
          }
        }
        if (!visited.has(target)) pending.push([...path, target]);
      }
    }
    return paths;
  };
  const importPaths = (
    root: string,
    targets: ReadonlySet<string>
  ): Map<string, string[]> =>
    new Map(
      [...importTargetPaths(root, targets)]
        .filter((entry): entry is [string, [string[], ...string[][]]] =>
          Boolean(entry[1][0])
        )
        .map(([target, paths]) => [target, paths[0]])
    );
  const importClosure = (roots: readonly string[]): Set<string> => {
    const closure = new Set<string>();
    const pending = [...roots];
    while (pending.length > 0) {
      const path = pending.pop();
      if (!path || closure.has(path) || !sources.has(path)) continue;
      closure.add(path);
      for (const specifier of analysis(path).references) {
        const target = moduleGraph.resolveLocalModule(path, specifier, sources);
        if (target) pending.push(target);
      }
    }
    return closure;
  };
  return {
    importClosure,
    importPath: (root: string, targets: ReadonlySet<string>) =>
      importPaths(root, targets).values().next().value as string[] | undefined,
    importPaths,
    importTargetPaths,
    moduleReferences: (path: string) => analysis(path).references,
  };
}

function moduleReferences(path: string, source: string): readonly string[] {
  return analyzeModule(path, source).references;
}

function importPaths(
  root: string,
  targets: ReadonlySet<string>,
  sources: ReadonlyMap<string, string>
): Map<string, string[]> {
  return create(sources).importPaths(root, targets);
}

function importPath(
  root: string,
  targets: ReadonlySet<string>,
  sources: ReadonlyMap<string, string>
): string[] | undefined {
  return create(sources).importPath(root, targets);
}

function importTargetPaths(
  root: string,
  targets: ReadonlySet<string>,
  sources: ReadonlyMap<string, string>
): Map<string, string[][]> {
  return create(sources).importTargetPaths(root, targets);
}

function importClosure(
  roots: readonly string[],
  sources: ReadonlyMap<string, string>
): Set<string> {
  return create(sources).importClosure(roots);
}

export const eventPipelineStaticModuleGraph = {
  create,
  importClosure,
  importPath,
  importPaths,
  importTargetPaths,
  moduleReferences,
} as const;
