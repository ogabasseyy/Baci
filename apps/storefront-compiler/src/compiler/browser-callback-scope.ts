import ts from '@typescript/typescript6';
import { resolveStaticString } from './const-string-fold';
import { resolveLexicalDeclaration } from './dom-subobject-destructure';
import { bindingContainsName } from './jsx-export-graph';
import { hasInnerShadowing } from './lexical-const-lookup';

const REACT_EFFECT_HOOKS: ReadonlySet<string> = new Set([
  'useEffect',
  'useLayoutEffect',
  'useInsertionEffect',
]);

export interface ReactEffectBindings {
  directHooks: Set<string>;
  namespaces: Set<string>;
}

export function collectReactEffectBindings(
  sf: ts.SourceFile
): ReactEffectBindings {
  const directHooks = new Set<string>();
  const namespaces = new Set<string>();
  for (const stmt of sf.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      stmt.importClause?.isTypeOnly ||
      !ts.isStringLiteral(stmt.moduleSpecifier) ||
      stmt.moduleSpecifier.text !== 'react' ||
      !stmt.importClause
    ) {
      continue;
    }
    if (stmt.importClause.name) namespaces.add(stmt.importClause.name.text);
    const bindings = stmt.importClause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    } else if (ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        if (
          !el.isTypeOnly &&
          REACT_EFFECT_HOOKS.has((el.propertyName ?? el.name).text)
        ) {
          directHooks.add(el.name.text);
        }
      }
    }
  }
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        for (const h of [...directHooks]) {
          if (bindingContainsName(d.name, h)) directHooks.delete(h);
        }
        for (const ns of [...namespaces]) {
          if (bindingContainsName(d.name, ns)) namespaces.delete(ns);
        }
      }
    } else if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
      stmt.name
    ) {
      directHooks.delete(stmt.name.text);
      namespaces.delete(stmt.name.text);
    }
  }
  return { directHooks, namespaces };
}

export function isDirectBrowserCallbackSlot(
  expr: ts.Node,
  effects: ReactEffectBindings
): boolean {
  let exprNode: ts.Node = expr;
  while (
    exprNode.parent &&
    (ts.isParenthesizedExpression(exprNode.parent) ||
      ts.isAsExpression(exprNode.parent) ||
      ts.isSatisfiesExpression(exprNode.parent))
  ) {
    exprNode = exprNode.parent;
  }
  const p = exprNode.parent;
  if (!p) return false;
  if (ts.isCallExpression(p) && p.arguments[0] === exprNode) {
    const c = p.expression;
    if (
      ts.isIdentifier(c) &&
      effects.directHooks.has(c.text) &&
      !hasInnerShadowing(c, c.text)
    ) {
      return true;
    }
    const nsHook = ts.isPropertyAccessExpression(c)
      ? c.name.text
      : ts.isElementAccessExpression(c)
        ? resolveStaticString(c.argumentExpression)
        : null;
    if (
      nsHook !== null &&
      REACT_EFFECT_HOOKS.has(nsHook) &&
      (ts.isPropertyAccessExpression(c) || ts.isElementAccessExpression(c)) &&
      ts.isIdentifier(c.expression) &&
      effects.namespaces.has(c.expression.text) &&
      !hasInnerShadowing(c.expression, c.expression.text)
    ) {
      return true;
    }
  }
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) {
    const attrName = ts.isIdentifier(p.parent.name) ? p.parent.name.text : '';
    const jsxElem = p.parent.parent?.parent;
    if (
      /^on[A-Z]/.test(attrName) &&
      jsxElem &&
      (ts.isJsxOpeningElement(jsxElem) ||
        ts.isJsxSelfClosingElement(jsxElem)) &&
      ts.isIdentifier(jsxElem.tagName) &&
      /^[a-z]/.test(jsxElem.tagName.text)
    ) {
      return true;
    }
  }
  return false;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some(
          (m) =>
            m.kind === ts.SyntaxKind.ExportKeyword ||
            m.kind === ts.SyntaxKind.DefaultKeyword
        )
  );
}

function unwrapFnInitializer(
  expr: ts.Expression
): ts.ArrowFunction | ts.FunctionExpression | null {
  let cur: ts.Expression = expr;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isSatisfiesExpression(cur)
  ) {
    cur = cur.expression;
  }
  return ts.isArrowFunction(cur) || ts.isFunctionExpression(cur) ? cur : null;
}

export function collectNamedBrowserOnlyFunctions(
  sf: ts.SourceFile,
  effects: ReactEffectBindings
): ReadonlySet<ts.FunctionLikeDeclaration> {
  const declToFn = new Map<ts.Node, ts.FunctionLikeDeclaration>();
  const discover = (n: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(n) &&
      n.name &&
      n.body &&
      !hasExportModifier(n)
    ) {
      declToFn.set(n, n);
    } else if (
      ts.isVariableStatement(n) &&
      !hasExportModifier(n) &&
      (n.declarationList.flags & ts.NodeFlags.Const) !== 0
    ) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) {
          const fn = unwrapFnInitializer(d.initializer);
          if (fn) declToFn.set(d, fn);
        }
      }
    }
    ts.forEachChild(n, discover);
  };
  discover(sf);

  const refsByDecl = new Map<ts.Node, ts.Identifier[]>();
  const gatherRefs = (n: ts.Node): void => {
    if (ts.isTypeNode(n)) {
      if (
        ts.isExpressionWithTypeArguments(n) &&
        ts.isHeritageClause(n.parent) &&
        n.parent.token === ts.SyntaxKind.ExtendsKeyword &&
        (ts.isClassDeclaration(n.parent.parent) ||
          ts.isClassExpression(n.parent.parent))
      ) {
        gatherRefs(n.expression);
      }
      return;
    }
    if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return;
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isOwnDeclName =
        (p && ts.isFunctionDeclaration(p) && p.name === n) ||
        (p && ts.isVariableDeclaration(p) && p.name === n) ||
        (p && ts.isFunctionExpression(p) && p.name === n) ||
        (p && ts.isPropertyAccessExpression(p) && p.name === n) ||
        (p && ts.isPropertyAssignment(p) && p.name === n) ||
        (p && ts.isJsxAttribute(p) && p.name === n);
      if (!isOwnDeclName) {
        const targetDecl = resolveLexicalDeclaration(n);
        if (targetDecl && declToFn.has(targetDecl)) {
          let list = refsByDecl.get(targetDecl);
          if (!list) {
            list = [];
            refsByDecl.set(targetDecl, list);
          }
          list.push(n);
        }
      }
    }
    ts.forEachChild(n, gatherRefs);
  };
  gatherRefs(sf);

  const activeDecls = new Set<ts.Node>(declToFn.keys());
  const isInsideApprovedCallback = (node: ts.Node): boolean => {
    let cur: ts.Node = node;
    while (cur.parent) {
      const p = cur.parent;
      if (
        (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) &&
        p.body &&
        (cur === p.body || p.body === node) &&
        isDirectBrowserCallbackSlot(p, effects)
      ) {
        return true;
      }
      if (
        (ts.isFunctionDeclaration(p) ||
          ts.isFunctionExpression(p) ||
          ts.isArrowFunction(p)) &&
        p.body &&
        (cur === p.body || p.body === node)
      ) {
        for (const d of activeDecls) {
          if (declToFn.get(d) === p) return true;
        }
      }
      cur = p;
    }
    return false;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const d of [...activeDecls]) {
      const refs = refsByDecl.get(d) ?? [];
      const allSafe =
        refs.length > 0 &&
        refs.every(
          (ref) =>
            isDirectBrowserCallbackSlot(ref, effects) ||
            isInsideApprovedCallback(ref)
        );
      if (!allSafe) {
        activeDecls.delete(d);
        changed = true;
      }
    }
  }

  const result = new Set<ts.FunctionLikeDeclaration>();
  for (const d of activeDecls) {
    const fn = declToFn.get(d);
    if (fn) result.add(fn);
  }
  return result;
}
