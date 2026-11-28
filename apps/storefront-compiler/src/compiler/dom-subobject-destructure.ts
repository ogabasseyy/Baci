import ts from '@typescript/typescript6';
import { resolveStaticString } from './const-string-fold';

export const MUTABLE_DOM_SUBOBJECT_MEMBERS: ReadonlySet<string> = new Set([
  'style',
  'attributes',
]);

function resolvePropKey(keyNode: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(keyNode) ||
    ts.isStringLiteral(keyNode) ||
    ts.isNumericLiteral(keyNode)
  ) {
    return keyNode.text;
  }
  return ts.isComputedPropertyName(keyNode)
    ? resolveStaticString(keyNode.expression)
    : null;
}

export function bindingDestructuresSubobject(
  pattern: ts.BindingName,
  target: string,
  underSubobject = false
): boolean {
  if (ts.isIdentifier(pattern)) {
    return underSubobject && pattern.text === target;
  }
  if (ts.isArrayBindingPattern(pattern)) {
    return pattern.elements.some(
      (el) =>
        ts.isBindingElement(el) &&
        bindingDestructuresSubobject(el.name, target, underSubobject)
    );
  }
  for (const el of pattern.elements) {
    if (el.dotDotDotToken) {
      if (bindingDestructuresSubobject(el.name, target, underSubobject)) {
        return true;
      }
      continue;
    }
    const key = el.propertyName
      ? resolvePropKey(el.propertyName)
      : ts.isIdentifier(el.name)
        ? el.name.text
        : null;
    const nextUnder =
      underSubobject ||
      (key !== null && MUTABLE_DOM_SUBOBJECT_MEMBERS.has(key));
    if (bindingDestructuresSubobject(el.name, target, nextUnder)) return true;
  }
  return false;
}

export function assignmentDestructuresSubobject(
  lhs: ts.Expression,
  target: string,
  underSubobject: boolean
): boolean {
  if (ts.isParenthesizedExpression(lhs)) {
    return assignmentDestructuresSubobject(
      lhs.expression,
      target,
      underSubobject
    );
  }
  if (ts.isIdentifier(lhs)) return underSubobject && lhs.text === target;
  if (ts.isArrayLiteralExpression(lhs)) {
    return lhs.elements.some((el) =>
      assignmentDestructuresSubobject(
        ts.isSpreadElement(el) ? el.expression : el,
        target,
        underSubobject
      )
    );
  }
  if (ts.isObjectLiteralExpression(lhs)) {
    return lhs.properties.some((prop) => {
      if (ts.isSpreadAssignment(prop)) {
        return assignmentDestructuresSubobject(
          prop.expression,
          target,
          underSubobject
        );
      }
      if (ts.isShorthandPropertyAssignment(prop)) {
        return (
          (underSubobject ||
            MUTABLE_DOM_SUBOBJECT_MEMBERS.has(prop.name.text)) &&
          prop.name.text === target
        );
      }
      if (ts.isPropertyAssignment(prop)) {
        const k = resolvePropKey(prop.name);
        const next =
          underSubobject ||
          (k !== null && MUTABLE_DOM_SUBOBJECT_MEMBERS.has(k));
        return assignmentDestructuresSubobject(prop.initializer, target, next);
      }
      return false;
    });
  }
  return false;
}
