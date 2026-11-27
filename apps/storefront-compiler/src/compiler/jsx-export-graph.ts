import path from 'node:path';
import ts from '@typescript/typescript6';
import {
  classifyPackageExport,
  isDirectComponentExpr,
  resolveDirectComponentKind,
  type SafeExportKind,
} from './component-expr-classifier';
import { collectReassignedIdentifiers } from './dom-mutation-guard';

export {
  classifyPackageExport,
  isDirectComponentExpr,
  resolveDirectComponentKind,
  type SafeExportKind,
};

const VIRTUAL_SUFFIXES =
  '|.tsx|.ts|.jsx|.js|/index.tsx|/index.ts|/index.jsx|/index.js'.split('|');

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

export function hasDeclareModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts
      .getModifiers(node)
      ?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ??
      false)
  );
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
): (filePath: string) => ReadonlyMap<string, SafeExportKind> {
  const exportCache = new Map<string, ReadonlyMap<string, SafeExportKind>>();
  const visiting = new Set<string>();

  const getSafeExports = (
    filePath: string
  ): ReadonlyMap<string, SafeExportKind> => {
    const cached = exportCache.get(filePath);
    if (cached) return cached;
    if (visiting.has(filePath)) return new Map();
    visiting.add(filePath);

    const sf = parsedFiles.get(filePath);
    const localSafe = new Map<string, SafeExportKind>();
    const exported = new Map<string, SafeExportKind>();

    if (sf) {
      for (const stmt of sf.statements) {
        if (hasDeclareModifier(stmt)) continue;
        if (
          ((ts.isFunctionDeclaration(stmt) && Boolean(stmt.body)) ||
            ts.isClassDeclaration(stmt)) &&
          stmt.name
        ) {
          localSafe.set(stmt.name.text, 'component');
        } else if (
          ts.isImportDeclaration(stmt) &&
          stmt.importClause &&
          !stmt.importClause.isTypeOnly &&
          ts.isStringLiteral(stmt.moduleSpecifier)
        ) {
          const spec = stmt.moduleSpecifier.text.trim();
          const clause = stmt.importClause;
          if (spec.startsWith('.')) {
            const target = resolveVirtualModule(filePath, spec, parsedFiles);
            const exp = target ? getSafeExports(target) : new Map();
            const defKind = exp.get('default');
            if (clause.name && defKind)
              localSafe.set(clause.name.text, defKind);
            if (
              clause.namedBindings &&
              ts.isNamedImports(clause.namedBindings)
            ) {
              for (const el of clause.namedBindings.elements) {
                const k = exp.get((el.propertyName ?? el.name).text);
                if (k) localSafe.set(el.name.text, k);
              }
            }
          } else if (
            clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings)
          ) {
            for (const el of clause.namedBindings.elements) {
              const k = classifyPackageExport(
                spec,
                (el.propertyName ?? el.name).text
              );
              if (k) localSafe.set(el.name.text, k);
            }
          }
        }
      }
      const reassigned = collectReassignedIdentifiers(sf);
      for (const stmt of sf.statements) {
        if (ts.isVariableStatement(stmt)) {
          for (const d of stmt.declarationList.declarations) {
            if (
              ts.isIdentifier(d.name) &&
              d.initializer &&
              !reassigned.has(d.name.text)
            ) {
              const k = resolveDirectComponentKind(
                d.initializer,
                (n) => localSafe.get(n) ?? null
              );
              if (k) localSafe.set(d.name.text, k);
            }
          }
        }
      }
      const starTargets: string[] = [];
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
          if (isDef && (!ts.isFunctionDeclaration(stmt) || Boolean(stmt.body)))
            exported.set('default', 'component');
          else if (
            isExp &&
            stmt.name &&
            (!ts.isFunctionDeclaration(stmt) || Boolean(stmt.body))
          ) {
            exported.set(stmt.name.text, 'component');
          }
        } else if (
          ts.isExpressionStatement(stmt) &&
          ts.isBinaryExpression(stmt.expression) &&
          stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(stmt.expression.left) &&
          ts.isIdentifier(stmt.expression.left.expression) &&
          stmt.expression.left.expression.text === 'module' &&
          stmt.expression.left.name.text === 'exports'
        ) {
          const k = resolveDirectComponentKind(
            stmt.expression.right,
            (n) => localSafe.get(n) ?? null
          );
          if (k) exported.set('default', k);
        } else if (
          ts.isVariableStatement(stmt) &&
          stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          for (const d of stmt.declarationList.declarations) {
            const k = ts.isIdentifier(d.name)
              ? localSafe.get(d.name.text)
              : undefined;
            if (ts.isIdentifier(d.name) && k) exported.set(d.name.text, k);
          }
        } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
          const k = resolveDirectComponentKind(
            stmt.expression,
            (n) => localSafe.get(n) ?? null
          );
          if (k) exported.set('default', k);
        } else if (ts.isExportDeclaration(stmt)) {
          const modSpec =
            stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
              ? stmt.moduleSpecifier.text.trim()
              : null;
          if (!stmt.exportClause && modSpec?.startsWith('.')) {
            const target = resolveVirtualModule(filePath, modSpec, parsedFiles);
            if (target) starTargets.push(target);
          } else if (
            stmt.exportClause &&
            ts.isNamedExports(stmt.exportClause)
          ) {
            const virtualSource = modSpec?.startsWith('.')
              ? (() => {
                  const t = resolveVirtualModule(
                    filePath,
                    modSpec,
                    parsedFiles
                  );
                  return t ? getSafeExports(t) : new Map();
                })()
              : null;
            for (const el of stmt.exportClause.elements) {
              const orig = (el.propertyName ?? el.name).text;
              const k =
                modSpec === null
                  ? localSafe.get(orig)
                  : virtualSource
                    ? virtualSource.get(orig)
                    : classifyPackageExport(modSpec, orig);
              if (k) exported.set(el.name.text, k);
            }
          }
        }
      }
      for (const target of starTargets) {
        for (const [name, k] of getSafeExports(target).entries()) {
          if (name !== 'default' && !exported.has(name)) exported.set(name, k);
        }
      }
    }

    visiting.delete(filePath);
    exportCache.set(filePath, exported);
    return exported;
  };

  return getSafeExports;
}
