import ts from '@typescript/typescript6';
import { resolveStaticOrConstString } from './const-string-fold';
import { assertAllowedAssetUrl } from './css-asset-policy';
import { extractAllCssResourceUrls } from './css-resource-urls';
import { normalizeCssForInspection } from './css-text-normalize';
import {
  classifyMemberName,
  resolveStaticString,
  type SourceSafetyViolation,
} from './source-guard-ast';

function assertInlineStyleTextSafe(
  styleValue: string,
  filePath: string,
  declaredAssetIds: ReadonlySet<string>
): string | null {
  const { withoutComments, unescaped } = normalizeCssForInspection(styleValue);
  for (const candidate of [withoutComments, unescaped]) {
    for (const rawUrl of extractAllCssResourceUrls(candidate)) {
      try {
        assertAllowedAssetUrl(rawUrl, filePath, declaredAssetIds);
      } catch (err) {
        return err instanceof Error ? err.message : 'Disallowed style URL';
      }
    }
  }
  return null;
}

const LOWER_NAV_JSX_ATTRS: ReadonlySet<string> = new Set(
  'href|action|formaction|xlinkhref|xlink:href'.split('|')
);
const SAFE_MEDIA_PRELOAD_VALUES: ReadonlySet<string> = new Set(
  '|none|metadata|auto'.split('|')
);

function hasUnsafePathChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x5c || code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isSafeStaticNavTarget(
  val: string,
  merchantSlug: string,
  internalOnly: boolean
): boolean {
  if (val.length === 0 || hasUnsafePathChar(val)) return false;
  if (val.startsWith('/') && !val.startsWith('//')) {
    try {
      const u = new URL(val, 'https://store.example');
      return (
        u.origin === 'https://store.example' && !u.pathname.startsWith('//')
      );
    } catch {
      return false;
    }
  }
  if (internalOnly) return false;
  if (val.startsWith('#')) return true;
  try {
    const u = new URL(val);
    if (u.username || u.password) return false;
    return (
      u.origin === 'https://usebaci.com' ||
      u.origin === `https://${merchantSlug}.usebaci.com`
    );
  } catch {
    return false;
  }
}

export interface JsxNavEnv {
  filePath: string;
  merchantSlug: string;
  declaredAssetIds: ReadonlySet<string>;
  isSdkLinkTag: (tagName: ts.JsxTagNameExpression) => boolean;
  violations: SourceSafetyViolation[];
}

function inspectEnclosingJsxElement(
  node: ts.Node,
  isSdkLinkTag: (tagName: ts.JsxTagNameExpression) => boolean
): { tag: string | null; isSdkLink: boolean } {
  const openLike = node.parent?.parent;
  if (
    !openLike ||
    (!ts.isJsxOpeningElement(openLike) && !ts.isJsxSelfClosingElement(openLike))
  ) {
    return { tag: null, isSdkLink: false };
  }
  const tag = ts.isIdentifier(openLike.tagName)
    ? openLike.tagName.text
    : ts.isPropertyAccessExpression(openLike.tagName)
      ? openLike.tagName.name.text
      : null;
  return { tag, isSdkLink: isSdkLinkTag(openLike.tagName) };
}

function checkJsxPropSafety(
  env: JsxNavEnv,
  el: { tag: string | null; isSdkLink: boolean },
  attrName: string,
  expr: ts.Expression | undefined,
  hasInit: boolean
): void {
  const lower = attrName.toLowerCase();
  if (
    lower === 'preload' &&
    (el.tag === 'video' || el.tag === 'audio') &&
    (!hasInit ||
      (expr !== undefined &&
        SAFE_MEDIA_PRELOAD_VALUES.has(
          resolveStaticOrConstString(expr) ?? '__bad__'
        )))
  ) {
    return;
  }
  classifyMemberName(env.filePath, attrName, env.violations);
  if (
    lower === 'style' &&
    hasInit &&
    expr &&
    ts.isObjectLiteralExpression(expr)
  ) {
    for (const p of expr.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const val = resolveStaticOrConstString(p.initializer);
      const err =
        val !== null
          ? assertInlineStyleTextSafe(val, env.filePath, env.declaredAssetIds)
          : null;
      if (err) {
        env.violations.push({
          filePath: env.filePath,
          rule: 'DANGEROUS_INNER_HTML',
          detail: err,
        });
      }
    }
    return;
  }
  const isSdkLinkPath = el.isSdkLink && attrName === 'path';
  if (lower === 'action' || lower === 'formaction') {
    env.violations.push({
      filePath: env.filePath,
      rule: 'DYNAMIC_CODE_EVAL',
      detail: `Native HTML form navigation via "${attrName}" is unsupported by the storefront host; handle <form onSubmit> in React`,
    });
    return;
  }
  if (!LOWER_NAV_JSX_ATTRS.has(lower) && !isSdkLinkPath) return;
  if (!hasInit || !expr) {
    if (isSdkLinkPath || hasInit) {
      env.violations.push({
        filePath: env.filePath,
        rule: 'DYNAMIC_CODE_EVAL',
        detail: `Empty JSX "${attrName}" expression is forbidden`,
      });
    }
    return;
  }
  const staticVal = resolveStaticOrConstString(expr);
  if (staticVal !== null) {
    if (!isSafeStaticNavTarget(staticVal, env.merchantSlug, isSdkLinkPath)) {
      env.violations.push({
        filePath: env.filePath,
        rule: 'DYNAMIC_CODE_EVAL',
        detail: `External or unsafe JSX "${attrName}" target "${staticVal}" is forbidden`,
      });
    }
    return;
  }
  if (ts.isTemplateExpression(expr)) {
    const head = expr.head.text;
    const safeLiterals =
      !hasUnsafePathChar(head) &&
      expr.templateSpans.every((s) => !hasUnsafePathChar(s.literal.text));
    const safePrefix =
      (head.startsWith('/') && !head.startsWith('//')) ||
      (!isSdkLinkPath &&
        (head.startsWith('https://usebaci.com/') ||
          head.startsWith(`https://${env.merchantSlug}.usebaci.com/`)));
    if (safeLiterals && safePrefix) return;
  }
  env.violations.push({
    filePath: env.filePath,
    rule: 'DYNAMIC_CODE_EVAL',
    detail: `Unverified dynamic JSX "${attrName}" target is forbidden`,
  });
}

export function checkJsxAttributeSafety(
  env: JsxNavEnv,
  attr: ts.JsxAttribute,
  sourceFile: ts.SourceFile
): void {
  const expr = !attr.initializer
    ? undefined
    : ts.isStringLiteral(attr.initializer)
      ? attr.initializer
      : ts.isJsxExpression(attr.initializer)
        ? attr.initializer.expression
        : undefined;
  checkJsxPropSafety(
    env,
    inspectEnclosingJsxElement(attr, env.isSdkLinkTag),
    attr.name.getText(sourceFile),
    expr,
    Boolean(attr.initializer)
  );
}

export function checkJsxSpreadAttributeSafety(
  env: JsxNavEnv,
  spread: ts.JsxSpreadAttribute
): void {
  const failSpread = (): void => {
    env.violations.push({
      filePath: env.filePath,
      rule: 'DANGEROUS_INNER_HTML',
      detail:
        'Non-static JSX spread attributes are forbidden; pass explicit props',
    });
  };
  if (!ts.isObjectLiteralExpression(spread.expression)) {
    failSpread();
    return;
  }
  const el = inspectEnclosingJsxElement(spread, env.isSdkLinkTag);
  for (const prop of spread.expression.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const name =
        ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
          ? prop.name.text
          : ts.isComputedPropertyName(prop.name)
            ? resolveStaticString(prop.name.expression)
            : null;
      if (name === null) {
        failSpread();
        return;
      }
      checkJsxPropSafety(env, el, name, prop.initializer, true);
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      checkJsxPropSafety(env, el, prop.name.text, prop.name, true);
    } else {
      failSpread();
      return;
    }
  }
}
