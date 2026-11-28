import ts from '@typescript/typescript6';
import {
  BENIGN_OBJECT_DATA_KEYS,
  FORBIDDEN_BROWSER_CAPABILITY_GLOBALS,
  SENSITIVE_GLOBAL_ROOTS,
} from './banned-specifiers';
import { resolveStaticString } from './const-string-fold';
import { bindingContainsName, hasDeclareModifier } from './jsx-export-graph';
import { hasLocalLexicalBinding } from './jsx-tag-safety';
import {
  isPropertyOrDeclarationName,
  type SourceSafetyViolation,
} from './source-guard-ast';

function isPureBooleanOpenRead(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isConditionalExpression(p) && p.condition === id) return true;
  if ((ts.isIfStatement(p) || ts.isWhileStatement(p)) && p.expression === id)
    return true;
  if (
    ts.isPrefixUnaryExpression(p) &&
    p.operator === ts.SyntaxKind.ExclamationToken
  )
    return true;
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    if (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken
    )
      return true;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken && p.left === id)
      return true;
  }
  return (
    ts.isCallExpression(p) &&
    ts.isIdentifier(p.expression) &&
    p.expression.text === 'Boolean' &&
    p.arguments.length === 1 &&
    p.arguments[0] === id &&
    !hasLocalLexicalBinding(p.expression, 'Boolean')
  );
}

function scopeDeclaresShadow(scope: ts.Node, target: string): boolean {
  if (
    (ts.isForStatement(scope) ||
      ts.isForInStatement(scope) ||
      ts.isForOfStatement(scope)) &&
    scope.initializer &&
    ts.isVariableDeclarationList(scope.initializer)
  ) {
    return scope.initializer.declarations.some((d) =>
      bindingContainsName(d.name, target)
    );
  }
  if (ts.isCatchClause(scope) && scope.variableDeclaration) {
    return bindingContainsName(scope.variableDeclaration.name, target);
  }
  if (
    ts.isFunctionDeclaration(scope) ||
    ts.isFunctionExpression(scope) ||
    ts.isArrowFunction(scope) ||
    ts.isMethodDeclaration(scope) ||
    ts.isConstructorDeclaration(scope)
  ) {
    if (scope.parameters.some((p) => bindingContainsName(p.name, target)))
      return true;
    if (ts.isFunctionExpression(scope) && scope.name?.text === target)
      return true;
  }
  if (ts.isBlock(scope)) {
    for (const stmt of scope.statements) {
      if (hasDeclareModifier(stmt)) continue;
      if (
        ts.isVariableStatement(stmt) &&
        stmt.declarationList.declarations.some((d) =>
          bindingContainsName(d.name, target)
        )
      )
        return true;
      if (
        (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
        stmt.name?.text === target
      )
        return true;
    }
  }
  return false;
}

export function checkOpenDestructuringSafety(
  sourceFile: ts.SourceFile,
  filePath: string,
  violations: SourceSafetyViolation[],
  isCommerceRoot?: (expr?: ts.Expression) => boolean
): void {
  const propOpenScopes = new Map<ts.Node, Set<string>>();
  const collect = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) {
      if (
        ts.isExpressionWithTypeArguments(node) &&
        ts.isHeritageClause(node.parent) &&
        node.parent.token === ts.SyntaxKind.ExtendsKeyword
      ) {
        collect(node.expression);
      }
      return;
    }
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      return;
    }
    if (
      ts.isObjectLiteralExpression(node) &&
      node.parent &&
      ts.isBinaryExpression(node.parent) &&
      node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.parent.left === node
    ) {
      for (const prop of node.properties) {
        const key = ts.isShorthandPropertyAssignment(prop)
          ? prop.name.text
          : ts.isPropertyAssignment(prop)
            ? ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
              ? prop.name.text
              : ts.isComputedPropertyName(prop.name)
                ? resolveStaticString(prop.name.expression)
                : null
            : null;
        if (
          key === 'open' ||
          key === 'navigation' ||
          (key !== null && BENIGN_OBJECT_DATA_KEYS.has(key))
        ) {
          violations.push({
            filePath,
            rule: 'DYNAMIC_CODE_EVAL',
            detail: `Assignment destructuring of "${key}" is forbidden`,
          });
        }
      }
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const keyNode = node.propertyName ?? node.name;
      const key =
        ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode)
          ? keyNode.text
          : ts.isComputedPropertyName(keyNode)
            ? resolveStaticString(keyNode.expression)
            : null;
      if (key === 'navigation') {
        const decl = ts.isVariableDeclaration(node.parent.parent)
          ? node.parent.parent
          : null;
        const list =
          decl && ts.isVariableDeclarationList(decl.parent)
            ? decl.parent
            : null;
        const isConst = Boolean(
          list && (list.flags & ts.NodeFlags.Const) !== 0
        );
        if (
          !decl ||
          !isConst ||
          node.dotDotDotToken ||
          !(isCommerceRoot?.(decl.initializer) ?? false)
        ) {
          violations.push({
            filePath,
            rule: 'DYNAMIC_CODE_EVAL',
            detail:
              'Direct browser navigation via "navigation" destructuring is forbidden; use @baci/experience-sdk navigation',
          });
        }
      } else if (key === 'caches') {
        violations.push({
          filePath,
          rule: 'DIRECT_COOKIE_ACCESS',
          detail:
            'Custom storefronts are cookie/storage-free; use @baci/experience-sdk APIs',
        });
      } else if (
        key !== null &&
        (SENSITIVE_GLOBAL_ROOTS.has(key) ||
          FORBIDDEN_BROWSER_CAPABILITY_GLOBALS.has(key))
      ) {
        violations.push({
          filePath,
          rule: 'DYNAMIC_CODE_EVAL',
          detail: `Destructuring browser global or capability "${key}" is forbidden`,
        });
      } else if (key === 'open') {
        const param = ts.isParameter(node.parent.parent)
          ? node.parent.parent
          : null;
        const fnScope = param?.parent;
        if (
          !param ||
          !fnScope ||
          node.dotDotDotToken ||
          node.propertyName !== undefined ||
          !ts.isIdentifier(node.name)
        ) {
          violations.push({
            filePath,
            rule: 'DYNAMIC_CODE_EVAL',
            detail:
              'Direct browser navigation via "open" destructuring is forbidden; use @baci/experience-sdk navigation',
          });
        } else {
          let names = propOpenScopes.get(fnScope);
          if (!names) {
            names = new Set();
            propOpenScopes.set(fnScope, names);
          }
          names.add(node.name.text);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  if (propOpenScopes.size === 0) return;

  const verify = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isPropertyOrDeclarationName(node)) {
      let cur: ts.Node | undefined = node.parent;
      while (cur) {
        if (propOpenScopes.get(cur)?.has(node.text)) {
          if (!isPureBooleanOpenRead(node)) {
            violations.push({
              filePath,
              rule: 'DYNAMIC_CODE_EVAL',
              detail:
                'Direct browser navigation via "open" is forbidden; prop "open" may only be read as a boolean',
            });
          }
          break;
        }
        if (scopeDeclaresShadow(cur, node.text)) {
          break;
        }
        cur = cur.parent;
      }
    }
    ts.forEachChild(node, verify);
  };
  verify(sourceFile);
}
