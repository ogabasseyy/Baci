import ts from '@typescript/typescript6';
import {
  bindingContainsName,
  classifyPackageExport,
  collectFileReactClassImports,
  createVirtualComponentExportResolver,
  hasDeclareModifier,
  isSyncComponentFunction,
  isVerifiedReactClassNode,
  resolveDirectComponentKind,
  resolveVirtualModule,
} from './jsx-export-graph';
import {
  hasHoistedVarInScope,
  hasInnerShadowing,
} from './lexical-const-lookup';

export function hasLocalLexicalBinding(
  atNode: ts.Node,
  target: string
): boolean {
  let cur: ts.Node | undefined = atNode.parent;
  while (cur) {
    if (
      ts.isCatchClause(cur) &&
      cur.variableDeclaration &&
      bindingContainsName(cur.variableDeclaration.name, target)
    ) {
      return true;
    }
    if (
      (ts.isFunctionDeclaration(cur) && Boolean(cur.body)) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      (ts.isMethodDeclaration(cur) && Boolean(cur.body)) ||
      (ts.isConstructorDeclaration(cur) && Boolean(cur.body))
    ) {
      if (cur.parameters.some((p) => bindingContainsName(p.name, target))) {
        return true;
      }
      if (ts.isFunctionExpression(cur) && cur.name?.text === target) {
        return true;
      }
    }
    if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
      for (const stmt of cur.statements) {
        if (hasDeclareModifier(stmt)) continue;
        if (
          ts.isVariableStatement(stmt) &&
          stmt.declarationList.declarations.some((d) =>
            bindingContainsName(d.name, target)
          )
        ) {
          return true;
        }
        if (
          ((ts.isFunctionDeclaration(stmt) && Boolean(stmt.body)) ||
            ts.isClassDeclaration(stmt)) &&
          stmt.name?.text === target
        ) {
          return true;
        }
        if (
          ts.isImportDeclaration(stmt) &&
          stmt.importClause &&
          !stmt.importClause.isTypeOnly &&
          (stmt.importClause.name?.text === target ||
            (stmt.importClause.namedBindings &&
              (ts.isNamespaceImport(stmt.importClause.namedBindings)
                ? stmt.importClause.namedBindings.name.text === target
                : stmt.importClause.namedBindings.elements.some(
                    (e) => !e.isTypeOnly && e.name.text === target
                  ))))
        ) {
          return true;
        }
      }
    }
    cur = cur.parent;
  }
  return false;
}

const FORBIDDEN_INTRINSIC_JSX_TAGS: ReadonlySet<string> = new Set(
  'script|style|iframe|frame|frameset|portal|object|embed|base|applet|link|meta'.split(
    '|'
  )
);

type BindingKind = 'component' | 'reactClass' | 'sdkLink' | 'motion' | 'unsafe';

export interface FileJsxTagInspector {
  checkJsxTag: (tagName: ts.JsxTagNameExpression) => string | null;
  isSdkLinkTag: (tagName: ts.JsxTagNameExpression) => boolean;
}

export function createJsxTagValidator(
  parsedFiles: ReadonlyMap<string, ts.SourceFile>
): (filePath: string, sf: ts.SourceFile) => FileJsxTagInspector {
  const getSafeComponentExports =
    createVirtualComponentExportResolver(parsedFiles);

  return (filePath: string, sf: ts.SourceFile): FileJsxTagInspector => {
    const importBindings = new Map<string, BindingKind>();
    const { reactClassBases, reactHocWrappers, reactNamespaces } =
      collectFileReactClassImports(sf);
    for (const stmt of sf.statements) {
      if (
        ts.isImportDeclaration(stmt) &&
        stmt.importClause &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const spec = stmt.moduleSpecifier.text.trim();
        const clause = stmt.importClause;
        if (spec.startsWith('.')) {
          const resolved = resolveVirtualModule(filePath, spec, parsedFiles);
          const exp = resolved ? getSafeComponentExports(resolved) : new Map();
          if (clause.name) {
            importBindings.set(
              clause.name.text,
              exp.get('default') ?? 'unsafe'
            );
          }
          if (clause.namedBindings) {
            if (ts.isNamespaceImport(clause.namedBindings)) {
              importBindings.set(clause.namedBindings.name.text, 'unsafe');
            } else {
              for (const el of clause.namedBindings.elements) {
                importBindings.set(
                  el.name.text,
                  exp.get((el.propertyName ?? el.name).text) ?? 'unsafe'
                );
              }
            }
          }
        } else {
          if (clause.name) importBindings.set(clause.name.text, 'unsafe');
          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              const orig = (el.propertyName ?? el.name).text;
              importBindings.set(
                el.name.text,
                spec === 'framer-motion' && orig === 'motion'
                  ? 'motion'
                  : (classifyPackageExport(spec, orig) ?? 'unsafe')
              );
            }
          }
        }
      }
    }

    const makeClassEnv = (nextDepth: number) => ({
      reactClassBases,
      reactHocWrappers,
      reactNamespaces,
      isVerifiedLocalClass: (at: ts.Node, ident: string) =>
        resolveBindingAt(at, ident, nextDepth) === 'reactClass',
      isShadowed: (at: ts.Node, ident: string) => hasInnerShadowing(at, ident),
    });

    const resolveBindingAt = (
      atNode: ts.Node,
      target: string,
      depth = 0
    ): BindingKind => {
      if (depth > 8) return 'unsafe';
      let cur: ts.Node | undefined = atNode.parent;
      while (cur) {
        if (
          ts.isCatchClause(cur) &&
          cur.variableDeclaration &&
          bindingContainsName(cur.variableDeclaration.name, target)
        ) {
          return 'unsafe';
        }
        if (ts.isClassExpression(cur) && cur.name?.text === target) {
          const inHeritage =
            cur.heritageClauses?.some(
              (hc) => atNode.pos >= hc.pos && atNode.end <= hc.end
            ) ?? false;
          if (inHeritage) return 'unsafe';
          return isVerifiedReactClassNode(cur, makeClassEnv(depth + 1))
            ? 'reactClass'
            : 'unsafe';
        }
        if (
          ts.isFunctionDeclaration(cur) ||
          ts.isFunctionExpression(cur) ||
          ts.isArrowFunction(cur) ||
          ts.isMethodDeclaration(cur) ||
          ts.isConstructorDeclaration(cur)
        ) {
          for (const p of cur.parameters) {
            if (bindingContainsName(p.name, target)) return 'unsafe';
          }
          if (hasHoistedVarInScope(cur, target)) return 'unsafe';
          if (ts.isFunctionExpression(cur) && cur.name?.text === target) {
            return isSyncComponentFunction(cur) ? 'component' : 'unsafe';
          }
        }
        if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
          if (ts.isSourceFile(cur) && hasHoistedVarInScope(cur, target)) {
            return 'unsafe';
          }
          for (const stmt of cur.statements) {
            if (hasDeclareModifier(stmt)) continue;
            if (ts.isVariableStatement(stmt)) {
              const isConst =
                (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
              for (const d of stmt.declarationList.declarations) {
                if (bindingContainsName(d.name, target)) {
                  if (!isConst || !ts.isIdentifier(d.name) || !d.initializer) {
                    return 'unsafe';
                  }
                  return (
                    resolveDirectComponentKind(
                      d.initializer,
                      (n) => {
                        if (n === target) return null;
                        const k = resolveBindingAt(d, n, depth + 1);
                        return k === 'component' ||
                          k === 'reactClass' ||
                          k === 'sdkLink'
                          ? k
                          : null;
                      },
                      (cls) =>
                        isVerifiedReactClassNode(cls, makeClassEnv(depth + 1)),
                      makeClassEnv(depth + 1)
                    ) ?? 'unsafe'
                  );
                }
              }
            } else if (
              ts.isFunctionDeclaration(stmt) &&
              stmt.body &&
              stmt.name?.text === target
            ) {
              return isSyncComponentFunction(stmt) ? 'component' : 'unsafe';
            } else if (
              ts.isClassDeclaration(stmt) &&
              stmt.name?.text === target
            ) {
              return isVerifiedReactClassNode(stmt, makeClassEnv(depth + 1))
                ? 'reactClass'
                : 'unsafe';
            }
          }
          if (ts.isSourceFile(cur)) {
            return importBindings.get(target) ?? 'unsafe';
          }
        }
        cur = cur.parent;
      }
      return 'unsafe';
    };

    return {
      isSdkLinkTag: (tagName: ts.JsxTagNameExpression): boolean =>
        ts.isIdentifier(tagName) &&
        /^[A-Z]/.test(tagName.text) &&
        resolveBindingAt(tagName, tagName.text) === 'sdkLink',
      checkJsxTag: (tagName: ts.JsxTagNameExpression): string | null => {
        if (ts.isIdentifier(tagName)) {
          const t = tagName.text;
          if (/^[a-z]/.test(t)) {
            return FORBIDDEN_INTRINSIC_JSX_TAGS.has(t)
              ? `Executable or document-level JSX element "<${t}>" is forbidden`
              : null;
          }
          const k = resolveBindingAt(tagName, t);
          return k === 'component' || k === 'reactClass' || k === 'sdkLink'
            ? null
            : `JSX component "<${t}>" must reference a statically verified component function`;
        }
        if (
          ts.isPropertyAccessExpression(tagName) &&
          ts.isIdentifier(tagName.expression) &&
          resolveBindingAt(tagName, tagName.expression.text) === 'motion' &&
          /^[a-z][a-zA-Z0-9]*$/.test(tagName.name.text) &&
          !FORBIDDEN_INTRINSIC_JSX_TAGS.has(tagName.name.text)
        ) {
          return null;
        }
        return `Dynamic or unverified JSX member tag "<${tagName.getText(sf)}>" is forbidden`;
      },
    };
  };
}
