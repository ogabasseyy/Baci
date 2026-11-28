import ts from '@typescript/typescript6';
import { resolveStaticString } from './const-string-fold';

export type SafeExportKind = 'component' | 'reactClass' | 'sdkLink';

export interface ReactClassHeritageEnv {
  reactClassBases: ReadonlySet<string>;
  reactNamespaces: ReadonlySet<string>;
  isVerifiedLocalClass?: (atNode: ts.Node, ident: string) => boolean;
  isShadowed?: (atNode: ts.Node, ident: string) => boolean;
}

function unwrapExpr(expr: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr)
  ) {
    return unwrapExpr(expr.expression);
  }
  return expr;
}

export function collectFileReactClassImports(sf: ts.SourceFile): {
  reactClassBases: Set<string>;
  reactHocWrappers: Map<string, 'memo' | 'forwardRef'>;
  reactNamespaces: Set<string>;
} {
  const reactClassBases = new Set<string>();
  const reactHocWrappers = new Map<string, 'memo' | 'forwardRef'>();
  const reactNamespaces = new Set<string>();
  for (const stmt of sf.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !stmt.importClause ||
      stmt.importClause.isTypeOnly ||
      !ts.isStringLiteral(stmt.moduleSpecifier) ||
      stmt.moduleSpecifier.text.trim() !== 'react'
    ) {
      continue;
    }
    const clause = stmt.importClause;
    if (clause.name) reactNamespaces.add(clause.name.text);
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        reactNamespaces.add(clause.namedBindings.name.text);
      } else {
        for (const el of clause.namedBindings.elements) {
          if (el.isTypeOnly) continue;
          const orig = (el.propertyName ?? el.name).text;
          if (orig === 'Component' || orig === 'PureComponent') {
            reactClassBases.add(el.name.text);
          } else if (orig === 'memo' || orig === 'forwardRef') {
            reactHocWrappers.set(el.name.text, orig);
          }
        }
      }
    }
  }
  return { reactClassBases, reactHocWrappers, reactNamespaces };
}

export function isSyncComponentFunction(
  fn: ts.FunctionLikeDeclaration
): boolean {
  if (fn.asteriskToken) return false;
  return !(
    ts.canHaveModifiers(fn) &&
    ts.getModifiers(fn)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  );
}

function checkInstanceRenderMembers(cls: ts.ClassLikeDeclaration): {
  hasConcreteSync: boolean;
  hasInvalid: boolean;
} {
  let hasConcreteSync = false;
  let hasInvalid = false;
  for (const m of cls.members) {
    const isStatic =
      ts.canHaveModifiers(m) &&
      (ts
        .getModifiers(m)
        ?.some((k) => k.kind === ts.SyntaxKind.StaticKeyword) ??
        false);
    if (isStatic || !m.name) continue;
    const name =
      ts.isIdentifier(m.name) ||
      ts.isStringLiteral(m.name) ||
      ts.isNumericLiteral(m.name) ||
      ts.isPrivateIdentifier(m.name)
        ? m.name.text
        : ts.isComputedPropertyName(m.name)
          ? resolveStaticString(m.name.expression)
          : null;
    if (name === null) {
      hasInvalid = true;
      continue;
    }
    if (name !== 'render') continue;
    if (ts.isMethodDeclaration(m)) {
      if (!m.body) {
        if (!isSyncComponentFunction(m)) hasInvalid = true;
        continue;
      }
      if (isSyncComponentFunction(m)) hasConcreteSync = true;
      else hasInvalid = true;
      continue;
    }
    if (ts.isPropertyDeclaration(m) && m.initializer) {
      const init = unwrapExpr(m.initializer);
      if (
        (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
        isSyncComponentFunction(init)
      ) {
        hasConcreteSync = true;
      } else {
        hasInvalid = true;
      }
      continue;
    }
    hasInvalid = true;
  }
  return { hasConcreteSync, hasInvalid };
}

export function isVerifiedReactClassNode(
  cls: ts.ClassLikeDeclaration,
  env: ReactClassHeritageEnv
): boolean {
  if (
    ts.canHaveModifiers(cls) &&
    ts.getModifiers(cls)?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)
  ) {
    return false;
  }
  const renderInfo = checkInstanceRenderMembers(cls);
  if (renderInfo.hasInvalid) return false;
  const ext = cls.heritageClauses?.find(
    (h) => h.token === ts.SyntaxKind.ExtendsKeyword
  );
  const firstType = ext?.types[0];
  if (ext?.types.length !== 1 || !firstType) return false;
  const baseExpr = unwrapExpr(firstType.expression);
  if (ts.isIdentifier(baseExpr)) {
    if (env.isVerifiedLocalClass?.(baseExpr, baseExpr.text)) return true;
    if (env.isShadowed?.(baseExpr, baseExpr.text)) return false;
    return env.reactClassBases.has(baseExpr.text) && renderInfo.hasConcreteSync;
  }
  if (
    ts.isPropertyAccessExpression(baseExpr) &&
    ts.isIdentifier(baseExpr.expression) &&
    !env.isShadowed?.(baseExpr.expression, baseExpr.expression.text) &&
    env.reactNamespaces.has(baseExpr.expression.text) &&
    (baseExpr.name.text === 'Component' ||
      baseExpr.name.text === 'PureComponent')
  ) {
    return renderInfo.hasConcreteSync;
  }
  return false;
}

export interface ReactHocEnv {
  reactHocWrappers: ReadonlyMap<string, 'memo' | 'forwardRef'>;
  reactNamespaces: ReadonlySet<string>;
  isShadowed?: (atNode: ts.Node, ident: string) => boolean;
}

function getWrapperHocKind(
  callee: ts.Expression,
  env?: ReactHocEnv
): 'memo' | 'forwardRef' | null {
  if (!env) return null;
  const inner = unwrapExpr(callee);
  if (ts.isIdentifier(inner)) {
    if (env.isShadowed?.(inner, inner.text)) return null;
    return env.reactHocWrappers.get(inner.text) ?? null;
  }
  if (
    ts.isPropertyAccessExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    !env.isShadowed?.(inner.expression, inner.expression.text) &&
    env.reactNamespaces.has(inner.expression.text)
  ) {
    const name = inner.name.text;
    return name === 'forwardRef' || name === 'memo' ? name : null;
  }
  return null;
}

export function resolveDirectComponentKind(
  expr: ts.Expression,
  lookupKind: (name: string) => SafeExportKind | null,
  isValidClass?: (cls: ts.ClassExpression) => boolean,
  hocEnv?: ReactHocEnv
): SafeExportKind | null {
  const inner = unwrapExpr(expr);
  if (
    (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) &&
    isSyncComponentFunction(inner)
  ) {
    return 'component';
  }
  if (ts.isClassExpression(inner)) {
    return isValidClass?.(inner) ? 'reactClass' : null;
  }
  if (ts.isIdentifier(inner)) return lookupKind(inner.text);
  if (ts.isCallExpression(inner)) {
    const hocKind = getWrapperHocKind(inner.expression, hocEnv);
    if (!hocKind) return null;
    const arg0 = inner.arguments[0];
    if (arg0 === undefined) return null;
    const unwrappedArg = unwrapExpr(arg0);
    if (
      hocKind === 'forwardRef' &&
      ts.isCallExpression(unwrappedArg) &&
      getWrapperHocKind(unwrappedArg.expression, hocEnv) !== null
    ) {
      return null;
    }
    const innerKind = resolveDirectComponentKind(
      arg0,
      lookupKind,
      isValidClass,
      hocEnv
    );
    if (hocKind === 'forwardRef' && innerKind === 'reactClass') return null;
    return innerKind === 'reactClass' ? 'component' : innerKind;
  }
  return null;
}

export function isDirectComponentExpr(
  expr: ts.Expression,
  isKnownComponent: (name: string) => boolean
): boolean {
  return (
    resolveDirectComponentKind(expr, (n) =>
      isKnownComponent(n) ? 'component' : null
    ) !== null
  );
}

export function classifyPackageExport(
  spec: string,
  exportedName: string
): SafeExportKind | null {
  if (spec === '@baci/experience-sdk') {
    if (exportedName === 'Link') return 'sdkLink';
    if (exportedName === 'CommerceProvider') return 'component';
    return null;
  }
  if (spec === 'react') {
    return exportedName === 'Fragment' ||
      exportedName === 'Suspense' ||
      exportedName === 'StrictMode' ||
      exportedName === 'Profiler'
      ? 'component'
      : null;
  }
  if (spec === 'framer-motion') {
    return exportedName === 'AnimatePresence' ||
      exportedName === 'MotionConfig' ||
      exportedName === 'LazyMotion' ||
      exportedName === 'LayoutGroup'
      ? 'component'
      : null;
  }
  return null;
}
