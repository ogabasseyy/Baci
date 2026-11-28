import ts from '@typescript/typescript6';
import {
  collectNamedBrowserOnlyFunctions,
  collectReactEffectBindings,
  isDirectBrowserCallbackSlot,
  type ReactEffectBindings,
} from './browser-callback-scope';
import { resolveStaticString } from './const-string-fold';
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

function statementAlwaysExits(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
  return ts.isBlock(stmt) && stmt.statements.some(statementAlwaysExits);
}

function isGuardedBrowserGlobalAccess(
  node: ts.Node,
  target: BrowserGlobalName,
  effects: ReactEffectBindings,
  namedBrowserFns: ReadonlySet<ts.FunctionLikeDeclaration>
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
      (ts.isArrowFunction(p) ||
        ts.isFunctionExpression(p) ||
        ts.isFunctionDeclaration(p)) &&
      p.body &&
      (cur === p.body || p.body === node) &&
      (namedBrowserFns.has(p) ||
        ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) &&
          isDirectBrowserCallbackSlot(p, effects)))
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
  const namedBrowserFns = collectNamedBrowserOnlyFunctions(sourceFile, effects);
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
      !isGuardedBrowserGlobalAccess(node, node.text, effects, namedBrowserFns)
    ) {
      report(node.text);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      isBrowserGlobalName(node.name.text) &&
      isSsrGlobalHostReceiver(node.expression) &&
      !isOptionalChainedWorkerdGlobalRead(node) &&
      !isGuardedBrowserGlobalAccess(
        node,
        node.name.text,
        effects,
        namedBrowserFns
      )
    ) {
      report(node.name.text);
    } else if (ts.isElementAccessExpression(node)) {
      const k = resolveStaticString(node.argumentExpression);
      if (
        k !== null &&
        isBrowserGlobalName(k) &&
        isSsrGlobalHostReceiver(node.expression) &&
        !isOptionalChainedWorkerdGlobalRead(node) &&
        !isGuardedBrowserGlobalAccess(node, k, effects, namedBrowserFns)
      ) {
        report(k);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
}
