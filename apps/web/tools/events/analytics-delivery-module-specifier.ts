import ts from '@typescript/typescript6';
import { resolveLexicalBinding } from './analytics-delivery-lexical-binding';
import { resolveLexicalString } from './analytics-delivery-static-string';

function unwrap(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
    ? unwrap(expression.expression)
    : expression;
}

function constInitializer(
  expression: ts.Identifier,
  file: ts.SourceFile,
  at: ts.Node
): ts.Expression | undefined {
  const binding = resolveLexicalBinding(file, expression, at);
  return binding &&
    ts.isVariableDeclaration(binding) &&
    ts.getCombinedNodeFlags(binding.parent) & ts.NodeFlags.Const
    ? binding.initializer
    : undefined;
}

export function resolveLexicalModuleSpecifier(
  expression: ts.Expression | undefined,
  file: ts.SourceFile,
  at: ts.Node,
  seen = new Set<number>()
): string | undefined {
  if (!expression) return undefined;
  const direct = resolveLexicalString(expression, file, at);
  if (direct !== undefined) return direct;
  const value = unwrap(expression);
  if (ts.isTemplateExpression(value)) {
    let result = value.head.text;
    for (const span of value.templateSpans) {
      const substitution = resolveLexicalModuleSpecifier(
        span.expression,
        file,
        at,
        new Set(seen)
      );
      if (substitution === undefined) return undefined;
      result += substitution + span.literal.text;
    }
    return result;
  }
  if (!ts.isIdentifier(value)) return undefined;
  const initializer = constInitializer(value, file, at);
  if (!initializer || seen.has(initializer.pos)) return undefined;
  const nextSeen = new Set(seen);
  nextSeen.add(initializer.pos);
  return resolveLexicalModuleSpecifier(initializer, file, at, nextSeen);
}
