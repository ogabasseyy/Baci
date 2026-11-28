import ts from '@typescript/typescript6';
import { FORBIDDEN_DOM_MUTATION_MEMBERS } from './banned-specifiers';
import { resolveLocalConstInit } from './component-return-scope';
import { resolveStaticOrConstString } from './const-string-fold';
import { assertAllowedAssetUrl } from './css-asset-policy';
import { extractAllCssResourceUrls } from './css-resource-urls';
import { normalizeCssForInspection } from './css-text-normalize';
import {
  resolveStaticString,
  type SourceSafetyViolation,
} from './source-guard-ast';

export const MOTION_ANIMATION_PROP_NAMES: ReadonlySet<string> = new Set(
  'initial|animate|exit|whileHover|whileTap|whileFocus|whileDrag|whileInView|variants|values|transitionEnd'.split(
    '|'
  )
);

const FORBIDDEN_MOTION_TARGET_KEYS_LOWER: ReadonlySet<string> = new Set([
  ...Array.from(FORBIDDEN_DOM_MUTATION_MEMBERS, (m) => m.toLowerCase()),
  'xlink:href',
  'ping',
  'srcdoc',
]);

export function findInlineCssUrlViolation(
  val: string,
  filePath: string,
  declaredAssetIds: ReadonlySet<string>
): string | null {
  const { withoutComments, unescaped } = normalizeCssForInspection(val);
  for (const candidate of [withoutComments, unescaped]) {
    for (const rawUrl of extractAllCssResourceUrls(candidate)) {
      try {
        assertAllowedAssetUrl(rawUrl, filePath, declaredAssetIds);
      } catch (err) {
        return err instanceof Error ? err.message : 'Disallowed motion CSS URL';
      }
    }
  }
  return null;
}

export function checkMotionAnimationProp(
  filePath: string,
  attrName: string,
  expr: ts.Expression | undefined,
  declaredAssetIds: ReadonlySet<string>,
  violations: SourceSafetyViolation[],
  seen: Set<ts.Node> = new Set()
): void {
  if (!expr || seen.has(expr)) return;
  seen.add(expr);
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    checkMotionAnimationProp(
      filePath,
      attrName,
      expr.expression,
      declaredAssetIds,
      violations,
      seen
    );
    return;
  }
  if (ts.isIdentifier(expr)) {
    const init = resolveLocalConstInit(expr);
    if (init) {
      checkMotionAnimationProp(
        filePath,
        attrName,
        init,
        declaredAssetIds,
        violations,
        seen
      );
    }
    return;
  }
  if (ts.isConditionalExpression(expr)) {
    checkMotionAnimationProp(
      filePath,
      attrName,
      expr.whenTrue,
      declaredAssetIds,
      violations,
      seen
    );
    checkMotionAnimationProp(
      filePath,
      attrName,
      expr.whenFalse,
      declaredAssetIds,
      violations,
      seen
    );
    return;
  }
  if (ts.isArrayLiteralExpression(expr)) {
    for (const el of expr.elements) {
      if (!ts.isOmittedExpression(el)) {
        checkMotionAnimationProp(
          filePath,
          attrName,
          ts.isSpreadElement(el) ? el.expression : el,
          declaredAssetIds,
          violations,
          seen
        );
      }
    }
    return;
  }
  if (!ts.isObjectLiteralExpression(expr)) return;

  for (const prop of expr.properties) {
    if (ts.isSpreadAssignment(prop)) {
      violations.push({
        filePath,
        rule: 'DANGEROUS_INNER_HTML',
        detail: `Dynamic object spread inside Framer Motion prop "${attrName}" is forbidden`,
      });
      continue;
    }
    if (
      !ts.isPropertyAssignment(prop) &&
      !ts.isShorthandPropertyAssignment(prop)
    ) {
      continue;
    }
    const key = ts.isShorthandPropertyAssignment(prop)
      ? prop.name.text
      : ts.isIdentifier(prop.name) ||
          ts.isStringLiteral(prop.name) ||
          ts.isNumericLiteral(prop.name)
        ? prop.name.text
        : ts.isComputedPropertyName(prop.name)
          ? resolveStaticString(prop.name.expression)
          : null;
    if (key === null) {
      violations.push({
        filePath,
        rule: 'DANGEROUS_INNER_HTML',
        detail: `Dynamic computed property inside Framer Motion prop "${attrName}" is forbidden`,
      });
      continue;
    }
    if (
      key !== 'style' &&
      FORBIDDEN_MOTION_TARGET_KEYS_LOWER.has(key.toLowerCase())
    ) {
      violations.push({
        filePath,
        rule: 'DYNAMIC_CODE_EVAL',
        detail: `Navigation or resource attribute "${key}" inside Framer Motion prop "${attrName}" is forbidden`,
      });
      continue;
    }
    const valExpr = ts.isShorthandPropertyAssignment(prop)
      ? prop.name
      : prop.initializer;
    const folded = resolveStaticOrConstString(valExpr);
    if (folded !== null) {
      const urlErr = findInlineCssUrlViolation(
        folded,
        filePath,
        declaredAssetIds
      );
      if (urlErr) {
        violations.push({
          filePath,
          rule: 'DANGEROUS_INNER_HTML',
          detail: urlErr,
        });
      }
    } else {
      checkMotionAnimationProp(
        filePath,
        attrName,
        valExpr,
        declaredAssetIds,
        violations,
        seen
      );
    }
  }
}
