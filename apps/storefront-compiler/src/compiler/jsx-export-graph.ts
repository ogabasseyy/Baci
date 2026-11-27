import path from 'node:path';
import ts from '@typescript/typescript6';

const VIRTUAL_SUFFIXES = [
  '',
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '/index.tsx',
  '/index.ts',
  '/index.jsx',
  '/index.js',
] as const;

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

export function isDirectComponentExpr(
  expr: ts.Expression,
  isKnownComponent: (name: string) => boolean
): boolean {
  const inner = unwrapExpr(expr);
  if (
    ts.isArrowFunction(inner) ||
    ts.isFunctionExpression(inner) ||
    ts.isClassExpression(inner)
  ) {
    return true;
  }
  if (ts.isIdentifier(inner)) return isKnownComponent(inner.text);
  if (ts.isCallExpression(inner) && isWrapperHocCallee(inner.expression)) {
    const arg0 = inner.arguments[0];
    return arg0 !== undefined && isDirectComponentExpr(arg0, isKnownComponent);
  }
  return false;
}

export function bindingContainsName(
  binding: ts.BindingName,
  target: string
): boolean {
  if (ts.isIdentifier(binding)) return binding.text === target;
  for (const el of binding.elements) {
    if (ts.isBindingElement(el) && bindingContainsName(el.name, target)) {
      return true;
    }
  }
  return false;
}

export function resolveVirtualModule(
  fromPath: string,
  spec: string,
  files: ReadonlyMap<string, ts.SourceFile>
): string | null {
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromPath), spec)
  );
  if (base.startsWith('../') || base.startsWith('/')) return null;
  for (const suffix of VIRTUAL_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (files.has(candidate)) return candidate;
  }
  return null;
}

export function createVirtualComponentExportResolver(
  parsedFiles: ReadonlyMap<string, ts.SourceFile>
): (filePath: string) => ReadonlySet<string> {
  const exportCache = new Map<string, ReadonlySet<string>>();
  const visiting = new Set<string>();

  const getSafeComponentExports = (filePath: string): ReadonlySet<string> => {
    const cached = exportCache.get(filePath);
    if (cached) return cached;
    if (visiting.has(filePath)) return new Set();
    visiting.add(filePath);

    const sf = parsedFiles.get(filePath);
    const localSafe = new Set<string>();
    const exported = new Set<string>();

    if (sf) {
      for (const stmt of sf.statements) {
        if (
          (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
          stmt.name
        ) {
          localSafe.add(stmt.name.text);
        } else if (
          ts.isImportDeclaration(stmt) &&
          stmt.importClause &&
          ts.isStringLiteral(stmt.moduleSpecifier)
        ) {
          const spec = stmt.moduleSpecifier.text.trim();
          const clause = stmt.importClause;
          if (spec.startsWith('.')) {
            const target = resolveVirtualModule(filePath, spec, parsedFiles);
            const exp = target ? getSafeComponentExports(target) : new Set();
            if (clause.name && exp.has('default')) {
              localSafe.add(clause.name.text);
            }
            if (
              clause.namedBindings &&
              ts.isNamedImports(clause.namedBindings)
            ) {
              for (const el of clause.namedBindings.elements) {
                if (exp.has((el.propertyName ?? el.name).text)) {
                  localSafe.add(el.name.text);
                }
              }
            }
          } else {
            if (clause.name) localSafe.add(clause.name.text);
            if (
              clause.namedBindings &&
              ts.isNamedImports(clause.namedBindings)
            ) {
              for (const el of clause.namedBindings.elements) {
                if (/^[A-Z]/.test((el.propertyName ?? el.name).text)) {
                  localSafe.add(el.name.text);
                }
              }
            }
          }
        }
      }
      for (const stmt of sf.statements) {
        if (
          ts.isVariableStatement(stmt) &&
          (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0
        ) {
          for (const d of stmt.declarationList.declarations) {
            if (
              ts.isIdentifier(d.name) &&
              d.initializer &&
              isDirectComponentExpr(d.initializer, (n) => localSafe.has(n))
            ) {
              localSafe.add(d.name.text);
            }
          }
        }
      }
      for (const stmt of sf.statements) {
        if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
          const mods = ts.canHaveModifiers(stmt)
            ? ts.getModifiers(stmt)
            : undefined;
          const isExp = mods?.some(
            (m) => m.kind === ts.SyntaxKind.ExportKeyword
          );
          const isDef = mods?.some(
            (m) => m.kind === ts.SyntaxKind.DefaultKeyword
          );
          if (isDef) exported.add('default');
          else if (isExp && stmt.name) exported.add(stmt.name.text);
        } else if (
          ts.isVariableStatement(stmt) &&
          stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          for (const d of stmt.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && localSafe.has(d.name.text)) {
              exported.add(d.name.text);
            }
          }
        } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
          if (isDirectComponentExpr(stmt.expression, (n) => localSafe.has(n))) {
            exported.add('default');
          }
        } else if (ts.isExportDeclaration(stmt)) {
          if (
            !stmt.exportClause &&
            stmt.moduleSpecifier &&
            ts.isStringLiteral(stmt.moduleSpecifier)
          ) {
            const target = resolveVirtualModule(
              filePath,
              stmt.moduleSpecifier.text,
              parsedFiles
            );
            if (target) {
              for (const name of getSafeComponentExports(target)) {
                if (name !== 'default') exported.add(name);
              }
            }
          } else if (
            stmt.exportClause &&
            ts.isNamedExports(stmt.exportClause)
          ) {
            const sourceSet =
              stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
                ? (() => {
                    const t = resolveVirtualModule(
                      filePath,
                      stmt.moduleSpecifier.text,
                      parsedFiles
                    );
                    return t ? getSafeComponentExports(t) : new Set<string>();
                  })()
                : localSafe;
            for (const el of stmt.exportClause.elements) {
              if (sourceSet.has((el.propertyName ?? el.name).text)) {
                exported.add(el.name.text);
              }
            }
          }
        }
      }
    }

    visiting.delete(filePath);
    exportCache.set(filePath, exported);
    return exported;
  };

  return getSafeComponentExports;
}
