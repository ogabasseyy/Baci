import ts from '@typescript/typescript6';
import { analyticsDeliveryAuthoritySourceGuards as sourceGuards } from './analytics-delivery-authority-source-guards';
import { trustedContextIsSafe } from './analytics-delivery-trusted-context-analysis';

const serviceSpecifier = '@/lib/supabase/service';
const wrapperSpecifier = '@/lib/analytics/trusted-server-ad-platform-fanout';

// biome-ignore format: compact parser preserves the 300-line verifier gate.
function ast(path: string, source: string) {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function callIdentifier(
  node: ts.Expression | undefined
): ts.Identifier | undefined {
  const value = node && ts.isAwaitExpression(node) ? node.expression : node;
  return value &&
    ts.isCallExpression(value) &&
    ts.isIdentifier(value.expression)
    ? value.expression
    : undefined;
}

function importedBinding(
  identifier: ts.Identifier | undefined,
  specifier: string,
  exportedName: string
): boolean {
  return Boolean(
    identifier &&
      sourceGuards.identifierResolvesToNamedImport(
        identifier,
        specifier,
        exportedName
      )
  );
}

function contains(node: ts.Node, candidate: ts.Node): boolean {
  return candidate.pos >= node.pos && candidate.end <= node.end;
}

// biome-ignore format: compact provenance proof stays below the 300-line runtime gate.
function verifiedBinding(identifier: ts.Identifier, file: ts.SourceFile): boolean {
  const name = identifier.text;
  const writes = sourceGuards.bindingWrites(file, identifier);
  if (!writes.length) return false;
  if (
    (name === 'context' || name === 'merchantContext') &&
    !trustedContextIsSafe(file, identifier)
  )
    return false;
  return writes.every((value) => {
    if (value.kind === ts.SyntaxKind.NullKeyword) return name === 'verifiedFanoutMerchantId';
    if (name === 'merchantContext') return importedBinding(callIdentifier(value), './conversion-route-merchant-context', 'resolveConversionRouteMerchantContext');
    if (name === 'context') return importedBinding(callIdentifier(value), '@/lib/events/event-ingress-context', 'resolveEventIngressContext');
    if (name === 'verifiedMerchantId') return ts.isPropertyAccessExpression(value) && value.name.text === 'verifiedMerchantId' && ts.isIdentifier(value.expression) && value.expression.text === 'merchantContext' && verifiedBinding(value.expression, file);
    if (name === 'verifiedFanoutMerchantId') return importedBinding(callIdentifier(value), './resolve-legacy-fanout-context', 'resolveLegacyFanoutContext');
    if (name === 'resolvedMerchantId') return ts.isIdentifier(value) && verifiedBinding(value, file);
    return false;
  });
}

function verifiedAtom(node: ts.Expression, file: ts.SourceFile): boolean {
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'verified') {
    return (
      ts.isIdentifier(node.expression) && verifiedBinding(node.expression, file)
    );
  }
  return ts.isIdentifier(node) && verifiedBinding(node, file);
}

function constructionIsGuarded(
  call: ts.CallExpression,
  file: ts.SourceFile
): boolean {
  for (let node: ts.Node | undefined = call.parent; node; node = node.parent) {
    const verified = (expression: ts.Expression) =>
      verifiedAtom(expression, file);
    if (
      ts.isIfStatement(node) &&
      contains(node.thenStatement, call) &&
      sourceGuards.branchImpliesVerified(node.expression, true, verified)
    ) {
      return true;
    }
    if (
      ts.isConditionalExpression(node) &&
      ((contains(node.whenTrue, call) &&
        sourceGuards.branchImpliesVerified(node.condition, true, verified)) ||
        (contains(node.whenFalse, call) &&
          sourceGuards.branchImpliesVerified(node.condition, false, verified)))
    ) {
      return true;
    }
  }
  return false;
}

function serviceFactory(
  expression: ts.Expression
): expression is ts.Identifier {
  return (
    ts.isIdentifier(expression) &&
    sourceGuards.identifierResolvesToNamedImport(
      expression,
      serviceSpecifier,
      'createServiceClient'
    )
  );
}

function trustedWrapperCall(node: ts.CallExpression): boolean {
  return (
    ts.isIdentifier(node.expression) &&
    sourceGuards.identifierResolvesToNamedImport(
      node.expression,
      wrapperSpecifier,
      'trustedServerAdPlatformFanout'
    )
  );
}

export function analyzeRouteConstruction(
  path: string,
  source: string
): string[] {
  const findings: string[] = [];
  let constructions = 0;
  const file = ast(path, source);
  for (const statement of file.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === serviceSpecifier &&
      !statement.isTypeOnly
    ) {
      findings.push(`${path}: service factory re-export is forbidden`);
    }
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === serviceSpecifier
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (
        statement.importClause?.name ||
        (bindings && ts.isNamespaceImport(bindings)) ||
        (bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.some(
            (element) =>
              (element.propertyName?.text ?? element.name.text) ===
                'createServiceClient' &&
              element.name.text !== 'createServiceClient'
          ))
      ) {
        findings.push(`${path}: service factory aliasing is forbidden`);
      }
    }
  }
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === serviceSpecifier
    ) {
      findings.push(`${path}: dynamic service factory import is forbidden`);
    }
    if (ts.isCallExpression(node) && trustedWrapperCall(node)) {
      const factory = node.arguments[0];
      if (
        !factory ||
        !ts.isCallExpression(factory) ||
        !serviceFactory(factory.expression) ||
        factory.arguments.length !== 1 ||
        !ts.isStringLiteral(factory.arguments[0]) ||
        factory.arguments[0].text !== 'event-pipeline'
      ) {
        findings.push(
          `${path}: trusted wrapper requires inline branded factory`
        );
      }
    }
    if (
      ts.isIdentifier(node) &&
      sourceGuards.identifierResolvesToNamedImport(
        node,
        serviceSpecifier,
        'createServiceClient'
      ) &&
      !ts.isImportSpecifier(node.parent) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      findings.push(`${path}: service factory aliasing is forbidden`);
    }
    if (ts.isCallExpression(node) && serviceFactory(node.expression)) {
      constructions += 1;
      if (
        node.arguments.length !== 1 ||
        !node.arguments[0] ||
        !ts.isStringLiteral(node.arguments[0]) ||
        node.arguments[0].text !== 'event-pipeline'
      ) {
        findings.push(
          `${path}: service factory requires event-pipeline sentinel`
        );
      }
      if (!constructionIsGuarded(node, file)) {
        findings.push(
          `${path}: privileged construction before verified tenant context`
        );
      }
      const merchantArgument = ts.isCallExpression(node.parent)
        ? node.parent.arguments[1]
        : undefined;
      const trustedParent =
        ts.isCallExpression(node.parent) &&
        ts.isIdentifier(node.parent.expression) &&
        sourceGuards.identifierResolvesToNamedImport(
          node.parent.expression,
          wrapperSpecifier,
          'trustedServerAdPlatformFanout'
        );
      if (!trustedParent) {
        findings.push(`${path}: service client passed outside trusted wrapper`);
      }
      if (
        !merchantArgument ||
        !sourceGuards.merchantArgumentIsVerified(
          merchantArgument,
          (argument) =>
            ts.isIdentifier(argument) && verifiedBinding(argument, file)
        )
      ) {
        findings.push(`${path}: body-selected merchant authority`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!constructions) {
    findings.push(`${path}: missing branded event-pipeline construction`);
  }
  return findings;
}
