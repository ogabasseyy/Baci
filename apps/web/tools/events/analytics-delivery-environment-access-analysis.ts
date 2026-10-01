import ts from '@typescript/typescript6';
import { resolveLexicalBinding } from './analytics-delivery-lexical-binding';
import { resolveLexicalString } from './analytics-delivery-static-string';

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function unwrap(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
    ? unwrap(expression.expression)
    : expression;
}

function member(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  file: ts.SourceFile,
  at: ts.Node
): string | undefined {
  return ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : resolveLexicalString(expression.argumentExpression, file, at);
}

function destructuredProperty(
  declaration: ts.VariableDeclaration,
  name: string
): string | undefined {
  if (!ts.isObjectBindingPattern(declaration.name)) return undefined;
  const element = declaration.name.elements.find(
    (candidate) =>
      ts.isIdentifier(candidate.name) && candidate.name.text === name
  );
  if (!element || !ts.isIdentifier(element.name)) return undefined;
  return element.propertyName && ts.isIdentifier(element.propertyName)
    ? element.propertyName.text
    : element.name.text;
}

export function readsCredentialEnvironment(
  path: string,
  source: string
): boolean {
  const file = parse(path, source);
  const visiting = new Set<number>();
  function initializer(
    identifier: ts.Identifier,
    at: ts.Node
  ): ts.Expression | undefined {
    const binding = resolveLexicalBinding(file, identifier, at);
    if (!binding || ts.isParameter(binding) || visiting.has(binding.pos))
      return undefined;
    visiting.add(binding.pos);
    return binding.initializer;
  }
  function isGlobalObject(expression: ts.Expression, at: ts.Node): boolean {
    const value = unwrap(expression);
    if (ts.isIdentifier(value)) {
      if (
        ['globalThis', 'global'].includes(value.text) &&
        !resolveLexicalBinding(file, value, at)
      ) {
        return true;
      }
      const valueInitializer = initializer(value, at);
      return Boolean(
        valueInitializer && isGlobalObject(valueInitializer, valueInitializer)
      );
    }
    return false;
  }
  function isProcess(expression: ts.Expression, at: ts.Node): boolean {
    const value = unwrap(expression);
    if (ts.isIdentifier(value)) {
      if (value.text === 'process' && !resolveLexicalBinding(file, value, at)) {
        return true;
      }
      const valueInitializer = initializer(value, at);
      return Boolean(
        valueInitializer && isProcess(valueInitializer, valueInitializer)
      );
    }
    if (
      (ts.isPropertyAccessExpression(value) ||
        ts.isElementAccessExpression(value)) &&
      member(value, file, at) === 'process'
    ) {
      return isGlobalObject(value.expression, at);
    }
    return false;
  }
  function isEnvironment(expression: ts.Expression, at: ts.Node): boolean {
    const value = unwrap(expression);
    if (ts.isIdentifier(value)) {
      const binding = resolveLexicalBinding(file, value, at);
      if (binding && ts.isVariableDeclaration(binding)) {
        const property = destructuredProperty(binding, value.text);
        if (property === 'env' && binding.initializer) {
          return isProcess(binding.initializer, binding);
        }
      }
      const valueInitializer = initializer(value, at);
      return Boolean(
        valueInitializer && isEnvironment(valueInitializer, valueInitializer)
      );
    }
    if (
      (ts.isPropertyAccessExpression(value) ||
        ts.isElementAccessExpression(value)) &&
      member(value, file, at) === 'env'
    ) {
      return isProcess(value.expression, at);
    }
    if (
      ts.isCallExpression(value) &&
      ts.isPropertyAccessExpression(value.expression) &&
      ts.isIdentifier(value.expression.expression) &&
      value.expression.expression.text === 'Reflect' &&
      value.expression.name.text === 'get' &&
      resolveLexicalString(value.arguments[1], file, value) === 'env' &&
      value.arguments[0]
    ) {
      return isProcess(value.arguments[0], at);
    }
    return false;
  }
  let found = false;
  function visit(node: ts.Node) {
    if (ts.isExpression(node) && isEnvironment(node, node)) found = true;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}
