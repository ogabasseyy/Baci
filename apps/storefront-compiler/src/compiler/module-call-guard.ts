import ts from '@typescript/typescript6';
import {
  BANNED_MERCHANT_SUBPATH_SPECIFIERS,
  isProhibitedImportSpecifier,
} from './banned-specifiers';
import { resolveStaticString } from './const-string-fold';
import { hasLocalLexicalBinding } from './jsx-tag-safety';
import {
  isPropertyOrDeclarationName,
  type SourceSafetyViolation,
} from './source-guard-ast';

function isGlobalRequireCall(node: ts.CallExpression): boolean {
  return (
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    !hasLocalLexicalBinding(node.expression, 'require')
  );
}

export function checkDynamicImportOrRequireNode(
  node: ts.Node,
  filePath: string,
  violations: SourceSafetyViolation[]
): void {
  const fail = (rule: SourceSafetyViolation['rule'], detail: string): void => {
    violations.push({ filePath, rule, detail });
  };

  if (ts.isCallExpression(node)) {
    const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire = isGlobalRequireCall(node);
    if (!isImport && !isRequire) return;
    const spec =
      node.arguments.length === 1 && node.arguments[0]
        ? resolveStaticString(node.arguments[0])
        : null;
    if (spec === null) {
      fail(
        'DYNAMIC_CODE_EVAL',
        isImport
          ? 'Non-literal dynamic import() is forbidden'
          : 'Non-literal or multi-arg require() is forbidden'
      );
      return;
    }
    if (
      isProhibitedImportSpecifier(spec) ||
      BANNED_MERCHANT_SUBPATH_SPECIFIERS.has(spec.trim())
    ) {
      fail(
        'PROHIBITED_RUNTIME_IMPORT',
        `Prohibited runtime specifier "${spec}"`
      );
    }
    return;
  }

  if (
    ts.isIdentifier(node) &&
    node.text === 'require' &&
    !isPropertyOrDeclarationName(node) &&
    !hasLocalLexicalBinding(node, 'require')
  ) {
    const p = node.parent;
    const isDirectRequireCallCallee =
      p !== undefined && ts.isCallExpression(p) && p.expression === node;
    const isTypeofCheck =
      p !== undefined && ts.isTypeOfExpression(p) && p.expression === node;
    if (!isDirectRequireCallCallee && !isTypeofCheck) {
      fail(
        'DYNAMIC_CODE_EVAL',
        'Aliasing or passing global "require" is forbidden'
      );
    }
  }
}
