import ts from '@typescript/typescript6';
import { bindingContainsName, hasDeclareModifier } from './jsx-export-graph';
import {
  classifyMemberName,
  resolveStaticString,
  type SourceSafetyViolation,
} from './source-guard-ast';

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

function resolveStaticOrConstString(
  expr: ts.Expression,
  depth = 0
): string | null {
  if (depth > 8) return null;
  const direct = resolveStaticString(expr);
  if (direct !== null) return direct;
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    return resolveStaticOrConstString(expr.expression, depth + 1);
  }
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const l = resolveStaticOrConstString(expr.left, depth + 1);
    const r = resolveStaticOrConstString(expr.right, depth + 1);
    return l !== null && r !== null ? l + r : null;
  }
  if (ts.isTemplateExpression(expr)) {
    let acc = expr.head.text;
    for (const span of expr.templateSpans) {
      const mid = resolveStaticOrConstString(span.expression, depth + 1);
      if (mid === null) return null;
      acc += mid + span.literal.text;
    }
    return acc;
  }
  if (!ts.isIdentifier(expr)) return null;
  const target = expr.text;
  let cur: ts.Node | undefined = expr.parent;
  while (cur) {
    if (
      ts.isCatchClause(cur) &&
      cur.variableDeclaration &&
      bindingContainsName(cur.variableDeclaration.name, target)
    ) {
      return null;
    }
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isConstructorDeclaration(cur)
    ) {
      if (cur.parameters.some((p) => bindingContainsName(p.name, target))) {
        return null;
      }
      if (ts.isFunctionExpression(cur) && cur.name?.text === target) {
        return null;
      }
    }
    if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
      for (const stmt of cur.statements) {
        if (hasDeclareModifier(stmt)) continue;
        if (ts.isVariableStatement(stmt)) {
          const isConst =
            (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
          for (const d of stmt.declarationList.declarations) {
            if (bindingContainsName(d.name, target)) {
              return isConst &&
                ts.isIdentifier(d.name) &&
                d.initializer !== undefined
                ? resolveStaticOrConstString(d.initializer, depth + 1)
                : null;
            }
          }
        } else if (
          (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
          stmt.name?.text === target
        ) {
          return null;
        }
      }
    }
    cur = cur.parent;
  }
  return null;
}

function isSafeStaticNavTarget(val: string, merchantSlug: string): boolean {
  if (val.length === 0 || hasUnsafePathChar(val)) return false;
  if (val.startsWith('#')) return true;
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
  try {
    const u = new URL(val);
    if (u.username || u.password) return false;
    const trustedOrigin = `https://${merchantSlug}.usebaci.com`;
    return u.origin === 'https://usebaci.com' || u.origin === trustedOrigin;
  } catch {
    return false;
  }
}

function getEnclosingTagName(attrOrSpread: ts.Node): string | null {
  const openLike = attrOrSpread.parent?.parent;
  if (
    !openLike ||
    (!ts.isJsxOpeningElement(openLike) && !ts.isJsxSelfClosingElement(openLike))
  ) {
    return null;
  }
  if (ts.isIdentifier(openLike.tagName)) return openLike.tagName.text;
  return ts.isPropertyAccessExpression(openLike.tagName)
    ? openLike.tagName.name.text
    : null;
}

interface JsxSafetyCtx {
  filePath: string;
  tag: string | null;
  merchantSlug: string;
  violations: SourceSafetyViolation[];
}

function checkJsxPropSafety(
  ctx: JsxSafetyCtx,
  attrName: string,
  expr: ts.Expression | undefined,
  hasInit: boolean
): void {
  const lower = attrName.toLowerCase();
  if (
    lower === 'preload' &&
    (ctx.tag === 'video' || ctx.tag === 'audio') &&
    (!hasInit ||
      (expr !== undefined &&
        SAFE_MEDIA_PRELOAD_VALUES.has(
          resolveStaticOrConstString(expr) ?? '__bad__'
        )))
  ) {
    return;
  }
  classifyMemberName(ctx.filePath, attrName, ctx.violations);
  if (!LOWER_NAV_JSX_ATTRS.has(lower) || !hasInit) return;
  if (!expr) {
    ctx.violations.push({
      filePath: ctx.filePath,
      rule: 'DYNAMIC_CODE_EVAL',
      detail: `Empty JSX "${attrName}" expression is forbidden`,
    });
    return;
  }
  const staticVal = resolveStaticOrConstString(expr);
  if (staticVal !== null) {
    if (!isSafeStaticNavTarget(staticVal, ctx.merchantSlug)) {
      ctx.violations.push({
        filePath: ctx.filePath,
        rule: 'DYNAMIC_CODE_EVAL',
        detail: `External or unsafe JSX "${attrName}" target "${staticVal}" is forbidden; use internal paths or @baci/experience-sdk`,
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
      head.startsWith('https://usebaci.com/') ||
      head.startsWith(`https://${ctx.merchantSlug}.usebaci.com/`);
    if (safeLiterals && safePrefix) return;
  }
  ctx.violations.push({
    filePath: ctx.filePath,
    rule: 'DYNAMIC_CODE_EVAL',
    detail: `Unverified dynamic JSX "${attrName}" target is forbidden; use internal paths or @baci/experience-sdk`,
  });
}

export function checkJsxAttributeSafety(
  filePath: string,
  attr: ts.JsxAttribute,
  sourceFile: ts.SourceFile,
  merchantSlug: string,
  violations: SourceSafetyViolation[]
): void {
  const expr = !attr.initializer
    ? undefined
    : ts.isStringLiteral(attr.initializer)
      ? attr.initializer
      : ts.isJsxExpression(attr.initializer)
        ? attr.initializer.expression
        : undefined;
  checkJsxPropSafety(
    { filePath, tag: getEnclosingTagName(attr), merchantSlug, violations },
    attr.name.getText(sourceFile),
    expr,
    Boolean(attr.initializer)
  );
}

export function checkJsxSpreadAttributeSafety(
  filePath: string,
  spread: ts.JsxSpreadAttribute,
  merchantSlug: string,
  violations: SourceSafetyViolation[]
): void {
  const failSpread = () =>
    violations.push({
      filePath,
      rule: 'DANGEROUS_INNER_HTML',
      detail:
        'Non-static JSX spread attributes are forbidden; pass explicit props',
    });
  if (!ts.isObjectLiteralExpression(spread.expression)) {
    failSpread();
    return;
  }
  const ctx: JsxSafetyCtx = {
    filePath,
    tag: getEnclosingTagName(spread),
    merchantSlug,
    violations,
  };
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
      checkJsxPropSafety(ctx, name, prop.initializer, true);
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      checkJsxPropSafety(ctx, prop.name.text, prop.name, true);
    } else {
      failSpread();
      return;
    }
  }
}
