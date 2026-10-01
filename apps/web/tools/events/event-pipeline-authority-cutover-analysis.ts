import ts from '@typescript/typescript6';

function unwrap(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
    ? unwrap(expression.expression)
    : expression;
}

export function readQueueOnlyDeliveryCutover(
  source: string
): boolean | undefined {
  const file = ts.createSourceFile(
    'event-pipeline-authority-cutover.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const declarations: ts.VariableDeclaration[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'eventPipelineAuthorityCutover'
    ) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (declarations.length !== 1) return undefined;
  const initializer = declarations[0]?.initializer;
  if (!initializer) return undefined;
  const value = unwrap(initializer);
  if (!ts.isObjectLiteralExpression(value)) return undefined;
  const properties = value.properties.filter(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) &&
        property.name.text === 'queueOnlyDeliveryActivated') ||
        (ts.isStringLiteralLike(property.name) &&
          property.name.text === 'queueOnlyDeliveryActivated'))
  );
  if (properties.length !== 1) return undefined;
  const marker = unwrap(properties[0].initializer);
  if (marker.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (marker.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}
