import ts from '@typescript/typescript6';

export type SafeExportKind = 'component' | 'sdkLink';

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
  lookupKind: (name: string) => SafeExportKind | null
): SafeExportKind | null {
  const inner = unwrapExpr(expr);
  if (
    ts.isArrowFunction(inner) ||
    ts.isFunctionExpression(inner) ||
    ts.isClassExpression(inner)
  ) {
    return 'component';
  }
  if (ts.isIdentifier(inner)) return lookupKind(inner.text);
  if (ts.isCallExpression(inner) && isWrapperHocCallee(inner.expression)) {
    const arg0 = inner.arguments[0];
    return arg0 !== undefined
      ? resolveDirectComponentKind(arg0, lookupKind)
      : null;
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
