import ts from '@typescript/typescript6';
import { resolveStaticString } from './const-string-fold';
import { bindingContainsName } from './jsx-export-graph';
import { hasLocalLexicalBinding } from './jsx-tag-safety';
import { hasInnerShadowing } from './lexical-const-lookup';
import {
  isPropertyOrDeclarationName,
  type SourceSafetyViolation,
} from './source-guard-ast';
import {
  type BrowserGlobalName,
  guaranteesDefinedWhenFalsy,
  guaranteesDefinedWhenTruthy,
  isBrowserGlobalName,
  isOptionalChainedWorkerdGlobalRead,
  isSsrGlobalHostReceiver,
} from './typeof-global-guard';

const REACT_EFFECT_HOOKS: ReadonlySet<string> = new Set([
  'useEffect',
  'useLayoutEffect',
  'useInsertionEffect',
]);

interface ReactEffectBindings {
  directHooks: Set<string>;
  namespaces: Set<string>;
}

function collectReactEffectBindings(sf: ts.SourceFile): ReactEffectBindings {
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

function statementAlwaysExits(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
  return ts.isBlock(stmt) && stmt.statements.some(statementAlwaysExits);
}

function isBrowserOnlyCallbackFunction(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  effects: ReactEffectBindings
): boolean {
  let exprNode: ts.Node = fn;
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

function isGuardedBrowserGlobalAccess(
  node: ts.Node,
  target: BrowserGlobalName,
  effects: ReactEffectBindings
): boolean {
  let exprOrParen: ts.Node = node;
  while (
    exprOrParen.parent &&
    ts.isParenthesizedExpression(exprOrParen.parent)
  ) {
    exprOrParen = exprOrParen.parent;
  }
  if (
    exprOrParen.parent &&
    ts.isTypeOfExpression(exprOrParen.parent) &&
    exprOrParen.parent.expression === exprOrParen
  ) {
    return true;
  }
  let cur: ts.Node = node;
  let crossedFn = false;
  while (cur.parent) {
    const p = cur.parent;
    if (
      (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) &&
      p.body &&
      (cur === p.body || p.body === node) &&
      isBrowserOnlyCallbackFunction(p, effects)
    ) {
      return true;
    }
    if (
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isArrowFunction(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p)
    ) {
      crossedFn = true;
    }
    if (
      ts.isConditionalExpression(p) &&
      ((cur === p.whenTrue &&
        guaranteesDefinedWhenTruthy(p.condition, target)) ||
        (cur === p.whenFalse &&
          guaranteesDefinedWhenFalsy(p.condition, target)))
    ) {
      return true;
    }
    if (
      ts.isBinaryExpression(p) &&
      cur === p.right &&
      ((p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        guaranteesDefinedWhenTruthy(p.left, target)) ||
        (p.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
          guaranteesDefinedWhenFalsy(p.left, target)))
    ) {
      return true;
    }
    if (
      ts.isIfStatement(p) &&
      ((cur === p.thenStatement &&
        guaranteesDefinedWhenTruthy(p.expression, target)) ||
        (cur === p.elseStatement &&
          guaranteesDefinedWhenFalsy(p.expression, target)))
    ) {
      return true;
    }
    if (
      !crossedFn &&
      ts.isBlock(p) &&
      !ts.isFunctionDeclaration(cur) &&
      ts.isStatement(cur)
    ) {
      const idx = p.statements.indexOf(cur);
      for (let i = 0; i < idx; i++) {
        const prev = p.statements[i];
        if (
          ts.isIfStatement(prev) &&
          !prev.elseStatement &&
          statementAlwaysExits(prev.thenStatement) &&
          guaranteesDefinedWhenFalsy(prev.expression, target)
        ) {
          return true;
        }
      }
    }
    cur = p;
  }
  return false;
}

export function checkBrowserGlobalSsrSafety(
  sourceFile: ts.SourceFile,
  filePath: string,
  violations: SourceSafetyViolation[]
): void {
  const effects = collectReactEffectBindings(sourceFile);
  const report = (name: BrowserGlobalName) =>
    violations.push({
      filePath,
      rule: 'DYNAMIC_CODE_EVAL',
      detail: `Unguarded SSR read of browser global "${name}" is forbidden; guard with typeof ${name} !== "undefined" or move into useEffect/event handler`,
    });
  const walk = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) {
      if (
        ts.isExpressionWithTypeArguments(node) &&
        ts.isHeritageClause(node.parent) &&
        node.parent.token === ts.SyntaxKind.ExtendsKeyword &&
        (ts.isClassDeclaration(node.parent.parent) ||
          ts.isClassExpression(node.parent.parent))
      ) {
        walk(node.expression);
      }
      return;
    }
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      return;
    }
    if (
      ts.isIdentifier(node) &&
      isBrowserGlobalName(node.text) &&
      !isPropertyOrDeclarationName(node) &&
      !hasLocalLexicalBinding(node, node.text) &&
      !hasInnerShadowing(node, node.text) &&
      !isGuardedBrowserGlobalAccess(node, node.text, effects)
    ) {
      report(node.text);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      isBrowserGlobalName(node.name.text) &&
      isSsrGlobalHostReceiver(node.expression) &&
      !isOptionalChainedWorkerdGlobalRead(node) &&
      !isGuardedBrowserGlobalAccess(node, node.name.text, effects)
    ) {
      report(node.name.text);
    } else if (ts.isElementAccessExpression(node)) {
      const k = resolveStaticString(node.argumentExpression);
      if (
        k !== null &&
        isBrowserGlobalName(k) &&
        isSsrGlobalHostReceiver(node.expression) &&
        !isOptionalChainedWorkerdGlobalRead(node) &&
        !isGuardedBrowserGlobalAccess(node, k, effects)
      ) {
        report(k);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
}
