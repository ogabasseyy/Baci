import ts from '@typescript/typescript6';

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
  reactNamespaces: Set<string>;
} {
  const reactClassBases = new Set<string>();
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
          }
        }
      }
    }
  }
  return { reactClassBases, reactNamespaces };
}

function hasConcreteInstanceRenderMember(
  cls: ts.ClassLikeDeclaration
): boolean {
  return cls.members.some((m) => {
    const isStatic =
      ts.canHaveModifiers(m) &&
      (ts
        .getModifiers(m)
        ?.some((k) => k.kind === ts.SyntaxKind.StaticKeyword) ??
        false);
    if (isStatic || !m.name) return false;
    const name =
      ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)
        ? m.name.text
        : null;
    if (name !== 'render') return false;
    if (ts.isMethodDeclaration(m)) return Boolean(m.body);
    if (ts.isPropertyDeclaration(m) && m.initializer) {
      const init = unwrapExpr(m.initializer);
      return ts.isArrowFunction(init) || ts.isFunctionExpression(init);
    }
    return false;
  });
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
  const ext = cls.heritageClauses?.find(
    (h) => h.token === ts.SyntaxKind.ExtendsKeyword
  );
  const firstType = ext?.types[0];
  if (ext?.types.length !== 1 || !firstType) return false;
  const baseExpr = unwrapExpr(firstType.expression);
  if (ts.isIdentifier(baseExpr)) {
    if (env.isVerifiedLocalClass?.(baseExpr, baseExpr.text)) return true;
    if (env.isShadowed?.(baseExpr, baseExpr.text)) return false;
    return (
      env.reactClassBases.has(baseExpr.text) &&
      hasConcreteInstanceRenderMember(cls)
    );
  }
  if (
    ts.isPropertyAccessExpression(baseExpr) &&
    ts.isIdentifier(baseExpr.expression) &&
    !env.isShadowed?.(baseExpr.expression, baseExpr.expression.text) &&
    env.reactNamespaces.has(baseExpr.expression.text) &&
    (baseExpr.name.text === 'Component' ||
      baseExpr.name.text === 'PureComponent')
  ) {
    return hasConcreteInstanceRenderMember(cls);
  }
  return false;
}

function isWrapperHocCallee(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) {
    return callee.text === 'forwardRef' || callee.text === 'memo';
  }
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'React' &&
    (callee.name.text === 'forwardRef' || callee.name.text === 'memo')
  );
}

export function resolveDirectComponentKind(
  expr: ts.Expression,
  lookupKind: (name: string) => SafeExportKind | null,
  isValidClass?: (cls: ts.ClassExpression) => boolean
): SafeExportKind | null {
  const inner = unwrapExpr(expr);
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) {
    return 'component';
  }
  if (ts.isClassExpression(inner)) {
    return isValidClass?.(inner) ? 'reactClass' : null;
  }
  if (ts.isIdentifier(inner)) return lookupKind(inner.text);
  if (ts.isCallExpression(inner) && isWrapperHocCallee(inner.expression)) {
    const arg0 = inner.arguments[0];
    if (arg0 === undefined) return null;
    const innerKind = resolveDirectComponentKind(
      arg0,
      lookupKind,
      isValidClass
    );
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
