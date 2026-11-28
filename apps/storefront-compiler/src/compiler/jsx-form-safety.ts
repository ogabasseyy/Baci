import ts from '@typescript/typescript6';
import type { JsxNavEnv } from './jsx-nav-safety';

function isPlausibleHandlerExpr(expr: ts.Expression | undefined): boolean {
  if (!expr) return false;
  if (
    expr.kind === ts.SyntaxKind.NullKeyword ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    ts.isNumericLiteral(expr) ||
    ts.isStringLiteralLike(expr)
  ) {
    return false;
  }
  return !(ts.isIdentifier(expr) && expr.text === 'undefined');
}

export function checkFormElementSafety(
  env: JsxNavEnv,
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile
): void {
  if (!ts.isIdentifier(node.tagName) || node.tagName.text !== 'form') return;
  let effectiveHasOnSubmit = false;
  for (const attr of node.attributes.properties) {
    if (ts.isJsxAttribute(attr)) {
      if (attr.name.getText(sourceFile) === 'onSubmit') {
        effectiveHasOnSubmit = Boolean(
          attr.initializer &&
            ts.isJsxExpression(attr.initializer) &&
            isPlausibleHandlerExpr(attr.initializer.expression)
        );
      }
    } else if (
      ts.isJsxSpreadAttribute(attr) &&
      ts.isObjectLiteralExpression(attr.expression)
    ) {
      for (const p of attr.expression.properties) {
        if (
          (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
          (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
          p.name.text === 'onSubmit'
        ) {
          effectiveHasOnSubmit = ts.isPropertyAssignment(p)
            ? isPlausibleHandlerExpr(p.initializer)
            : true;
        }
      }
    }
  }
  if (!effectiveHasOnSubmit) {
    env.violations.push({
      filePath: env.filePath,
      rule: 'DYNAMIC_CODE_EVAL',
      detail:
        'Uncontrolled native <form> without onSubmit is unsupported by the storefront host; handle onSubmit in React',
    });
  }
}
