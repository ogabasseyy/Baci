import ts from '@typescript/typescript6';
import { resolveStaticString } from './const-string-fold';
import { collectReassignedIdentifiers } from './dom-mutation-guard';
import { resolveVirtualModule } from './jsx-export-graph';
import {
  collectPropertyMutatedIdentifiers,
  findLexicalConstDeclaration,
  hasInnerShadowing,
} from './lexical-const-lookup';

const SDK_SPECIFIER = '@baci/experience-sdk';
const COMMERCE_HOOKS = new Set(['useCommerce']);

type SdkImportRole = 'commerceFactory' | 'sdkNamespace';

function unwrap(expr: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    return unwrap(expr.expression);
  }
  return expr;
}

export interface SdkOpenReceiverChecker {
  (expr?: ts.Expression): boolean;
  isCommerceRoot: (expr?: ts.Expression) => boolean;
}

export function createSdkOpenReceiverChecker(
  parsedFiles: ReadonlyMap<string, ts.SourceFile>
): (filePath: string, sf: ts.SourceFile) => SdkOpenReceiverChecker {
  const exportedFactoryCache = new Map<string, ReadonlySet<string>>();
  const visiting = new Set<string>();

  const getExportedCommerceFactories = (
    filePath: string
  ): ReadonlySet<string> => {
    const cached = exportedFactoryCache.get(filePath);
    if (cached) return cached;
    if (visiting.has(filePath)) return new Set();
    visiting.add(filePath);
    const out = new Set<string>();
    const sf = parsedFiles.get(filePath);
    if (sf) {
      for (const stmt of sf.statements) {
        if (
          ts.isExportDeclaration(stmt) &&
          stmt.exportClause &&
          ts.isNamedExports(stmt.exportClause) &&
          stmt.moduleSpecifier &&
          ts.isStringLiteral(stmt.moduleSpecifier)
        ) {
          const spec = stmt.moduleSpecifier.text.trim();
          for (const el of stmt.exportClause.elements) {
            const orig = (el.propertyName ?? el.name).text;
            if (spec === SDK_SPECIFIER && COMMERCE_HOOKS.has(orig)) {
              out.add(el.name.text);
            } else if (spec.startsWith('.')) {
              const rel = resolveVirtualModule(filePath, spec, parsedFiles);
              if (rel && getExportedCommerceFactories(rel).has(orig)) {
                out.add(el.name.text);
              }
            }
          }
        }
      }
    }
    visiting.delete(filePath);
    exportedFactoryCache.set(filePath, out);
    return out;
  };

  return (filePath: string, sf: ts.SourceFile) => {
    const imports = new Map<string, SdkImportRole>();
    for (const stmt of sf.statements) {
      if (
        !ts.isImportDeclaration(stmt) ||
        !stmt.importClause ||
        stmt.importClause.isTypeOnly ||
        !ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        continue;
      }
      const spec = stmt.moduleSpecifier.text.trim();
      const nb = stmt.importClause.namedBindings;
      if (spec === SDK_SPECIFIER && nb) {
        if (ts.isNamespaceImport(nb)) {
          imports.set(nb.name.text, 'sdkNamespace');
        } else if (ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            if (el.isTypeOnly) continue;
            const orig = (el.propertyName ?? el.name).text;
            if (COMMERCE_HOOKS.has(orig)) {
              imports.set(el.name.text, 'commerceFactory');
            }
          }
        }
      } else if (spec.startsWith('.') && nb && ts.isNamedImports(nb)) {
        const rel = resolveVirtualModule(filePath, spec, parsedFiles);
        const relFactories = rel ? getExportedCommerceFactories(rel) : null;
        if (relFactories) {
          for (const el of nb.elements) {
            if (
              !el.isTypeOnly &&
              relFactories.has((el.propertyName ?? el.name).text)
            ) {
              imports.set(el.name.text, 'commerceFactory');
            }
          }
        }
      }
    }

    const unsafeIds = new Set<string>([
      ...collectReassignedIdentifiers(sf),
      ...collectPropertyMutatedIdentifiers(sf),
    ]);

    const isTopLevelRole = (id: ts.Identifier, role: SdkImportRole): boolean =>
      imports.get(id.text) === role &&
      !unsafeIds.has(id.text) &&
      !hasInnerShadowing(id, id.text);

    const isCommerceExpr = (raw: ts.Expression, depth: number): boolean => {
      if (depth > 6) return false;
      const expr = unwrap(raw);
      if (ts.isCallExpression(expr)) {
        const callee = unwrap(expr.expression);
        if (ts.isIdentifier(callee))
          return isTopLevelRole(callee, 'commerceFactory');
        return (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          isTopLevelRole(callee.expression, 'sdkNamespace') &&
          COMMERCE_HOOKS.has(callee.name.text)
        );
      }
      if (ts.isIdentifier(expr) && !unsafeIds.has(expr.text)) {
        const found = findLexicalConstDeclaration(expr, expr.text);
        if (!found?.decl.initializer || found.bindingEl) return false;
        return isCommerceExpr(found.decl.initializer, depth + 1);
      }
      return false;
    };

    const isOpenSubclient = (raw?: ts.Expression, depth = 0): boolean => {
      if (!raw || depth > 6) return false;
      const expr = unwrap(raw);
      if (
        ts.isPropertyAccessExpression(expr) &&
        (expr.name.text === 'navigation' || expr.name.text === 'checkout')
      ) {
        return isCommerceExpr(expr.expression, depth + 1);
      }
      if (ts.isElementAccessExpression(expr)) {
        const key = resolveStaticString(expr.argumentExpression);
        if (key === 'navigation' || key === 'checkout') {
          return isCommerceExpr(expr.expression, depth + 1);
        }
      }
      if (ts.isIdentifier(expr) && !unsafeIds.has(expr.text)) {
        const found = findLexicalConstDeclaration(expr, expr.text);
        if (!found?.decl.initializer) return false;
        if (!found.bindingEl) {
          return isOpenSubclient(found.decl.initializer, depth + 1);
        }
        const key = found.bindingEl.propertyName ?? found.bindingEl.name;
        return (
          ts.isIdentifier(key) &&
          (key.text === 'navigation' || key.text === 'checkout') &&
          isCommerceExpr(found.decl.initializer, depth + 1)
        );
      }
      return false;
    };

    const fn = ((receiver?: ts.Expression) =>
      isOpenSubclient(receiver, 0)) as SdkOpenReceiverChecker;
    fn.isCommerceRoot = (expr?: ts.Expression) =>
      expr !== undefined && isCommerceExpr(expr, 0);
    return fn;
  };
}
