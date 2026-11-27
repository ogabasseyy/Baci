import ts from '@typescript/typescript6';
import { DYNAMIC_CODE_NAMES } from './banned-specifiers';

export interface SourceSafetyViolation {
  filePath: string;
  rule:
    | 'DYNAMIC_CODE_EVAL'
    | 'SERVICE_WORKER_ACCESS'
    | 'DIRECT_COOKIE_ACCESS'
    | 'DANGEROUS_INNER_HTML'
    | 'PROHIBITED_RUNTIME_IMPORT';
  detail: string;
}

export function classifyMemberName(
  filePath: string,
  memberName: string,
  violations: SourceSafetyViolation[]
): void {
  if (
    memberName === 'dangerouslySetInnerHTML' ||
    memberName === '__html' ||
    memberName === '$$typeof'
  ) {
    violations.push({
      filePath,
      rule: 'DANGEROUS_INNER_HTML',
      detail: `Forbidden raw HTML or React element symbol property "${memberName}"`,
    });
  } else if (
    memberName === 'createElement' ||
    memberName === 'cloneElement' ||
    memberName === 'createFactory'
  ) {
    violations.push({
      filePath,
      rule: 'DANGEROUS_INNER_HTML',
      detail: `Direct React factory "${memberName}" is forbidden; use JSX syntax`,
    });
  } else if (DYNAMIC_CODE_NAMES.has(memberName)) {
    violations.push({
      filePath,
      rule: 'DYNAMIC_CODE_EVAL',
      detail: `Dynamic code access via "${memberName}" is forbidden`,
    });
  } else if (memberName === 'serviceWorker') {
    violations.push({
      filePath,
      rule: 'SERVICE_WORKER_ACCESS',
      detail:
        'Service Worker registration or control is forbidden on storefronts',
    });
  } else if (memberName === 'cookie' || memberName === 'cookieStore') {
    violations.push({
      filePath,
      rule: 'DIRECT_COOKIE_ACCESS',
      detail:
        'Custom storefronts are cookie-free; use @baci/experience-sdk cart APIs',
    });
  }
}

/**
 * Constant-folds string literals, templates, and `+` concatenations so
 * obfuscated forms like `'dangerously' + 'SetInnerHTML'` or `globalThis['ev' + 'al']`
 * resolve to their runtime string value.
 */
export function resolveStaticString(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    return resolveStaticString(node.expression);
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = resolveStaticString(node.left);
    const right = resolveStaticString(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  if (ts.isTemplateExpression(node)) {
    let acc = node.head.text;
    for (const span of node.templateSpans) {
      const mid = resolveStaticString(span.expression);
      if (mid === null) return null;
      acc += mid + span.literal.text;
    }
    return acc;
  }
  return null;
}

export function isPropertyOrDeclarationName(node: ts.Identifier): boolean {
  const p = node.parent;
  if (!p) return false;
  if (
    (ts.isPropertyAccessExpression(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isPropertySignature(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isJsxAttribute(p) ||
      ts.isEnumMember(p)) &&
    p.name === node
  ) {
    return true;
  }
  if (ts.isBindingElement(p) && (p.propertyName === node || p.name === node)) {
    return true;
  }
  if (
    (ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isClassDeclaration(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) ||
      ts.isEnumDeclaration(p) ||
      ts.isTypeParameterDeclaration(p) ||
      ts.isImportClause(p) ||
      ts.isNamespaceImport(p)) &&
    p.name === node
  ) {
    return true;
  }
  if (
    (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) &&
    (p.name === node || p.propertyName === node)
  ) {
    return true;
  }
  return (
    (ts.isLabeledStatement(p) && p.label === node) ||
    ((ts.isBreakStatement(p) || ts.isContinueStatement(p)) && p.label === node)
  );
}

export function isAllowedSensitiveRootPosition(node: ts.Expression): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.expression === node) return true;
  if (ts.isTypeOfExpression(p) && p.expression === node) return true;
  return (
    ts.isElementAccessExpression(p) &&
    p.expression === node &&
    resolveStaticString(p.argumentExpression) !== null
  );
}
