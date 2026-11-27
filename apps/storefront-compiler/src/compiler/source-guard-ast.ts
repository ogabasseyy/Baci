import ts from '@typescript/typescript6';
import {
  DYNAMIC_CODE_NAMES,
  FORBIDDEN_BROWSER_NAV_GLOBALS,
  FORBIDDEN_STORAGE_MEMBERS,
  SENSITIVE_GLOBAL_ROOTS,
} from './banned-specifiers';
import { hasLocalLexicalBinding } from './jsx-tag-safety';

export { hasLocalLexicalBinding };

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

const LOWERCASE_HTML_SINK_NAMES: ReadonlySet<string> = new Set(
  [
    'dangerouslysetinnerhtml|__html|$$typeof|innerhtml|outerhtml|insertadjacenthtml',
    'srcdoc|createcontextualfragment|parsefromstring|setattribute|setattributens',
    'setattributenode|setattributenodens|createattribute|createattributens',
    'setnameditem|setnameditemns|getattributenode|getattributenodens|execcommand',
    'sethtmlunsafe|parsehtmlunsafe|sethtml|createhtml|createscript|createscripturl',
    'ownerdocument|contentdocument|contentwindow|defaultview|preinit|preinitmodule',
    'preload|preloadmodule|prefetchdns|preconnect|requestsubmit|dispatchevent',
    'implementation|createdocument|createhtmldocument|createdocumenttype',
    'createdocumentfragment|createrange|importnode|adoptnode|clonenode',
    'attachshadow|shadowroot|appendchild|insertbefore|replacechild|replacechildren',
    'insertadjacentelement|insertadjacenttext|prepend|replacewith',
  ]
    .join('|')
    .split('|')
);

function isDocumentReceiver(expr: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
    return isDocumentReceiver(expr.expression);
  }
  if (ts.isIdentifier(expr)) return expr.text === 'document';
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text === 'document';
  if (ts.isElementAccessExpression(expr)) {
    return resolveStaticString(expr.argumentExpression) === 'document';
  }
  return false;
}

function isSensitiveGlobalReceiver(expr: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
    return isSensitiveGlobalReceiver(expr.expression);
  }
  if (ts.isIdentifier(expr)) return SENSITIVE_GLOBAL_ROOTS.has(expr.text);
  if (ts.isPropertyAccessExpression(expr)) {
    return (
      SENSITIVE_GLOBAL_ROOTS.has(expr.name.text) ||
      isSensitiveGlobalReceiver(expr.expression)
    );
  }
  if (ts.isElementAccessExpression(expr)) {
    const k = resolveStaticString(expr.argumentExpression);
    return (
      (k !== null && SENSITIVE_GLOBAL_ROOTS.has(k)) ||
      isSensitiveGlobalReceiver(expr.expression)
    );
  }
  return false;
}

function isSafeStaticObjectLiteral(expr: ts.Expression): boolean {
  return (
    ts.isObjectLiteralExpression(expr) &&
    expr.properties.every(
      (p) => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)
    )
  );
}

function isAllowedObjectAssignCall(memberAccessNode?: ts.Node): boolean {
  if (!memberAccessNode?.parent) return false;
  const call = memberAccessNode.parent;
  if (!ts.isCallExpression(call) || call.expression !== memberAccessNode) {
    return false;
  }
  return (
    call.arguments.length >= 1 &&
    call.arguments.every((arg) => isSafeStaticObjectLiteral(arg))
  );
}

export function classifyMemberName(
  filePath: string,
  memberName: string,
  violations: SourceSafetyViolation[],
  receiver?: ts.Expression,
  memberAccessNode?: ts.Node
): void {
  const lowerMember = memberName.toLowerCase();
  const isUnsafeWrite =
    (memberName === 'write' || memberName === 'writeln') &&
    (memberAccessNode === undefined ||
      (memberAccessNode.parent !== undefined &&
        ts.isCallExpression(memberAccessNode.parent) &&
        memberAccessNode.parent.expression === memberAccessNode) ||
      (receiver !== undefined && isDocumentReceiver(receiver)));
  if (LOWERCASE_HTML_SINK_NAMES.has(lowerMember) || isUnsafeWrite) {
    violations.push({
      filePath,
      rule: 'DANGEROUS_INNER_HTML',
      detail: `Forbidden raw HTML or React element sink "${memberName}"`,
    });
  } else if (
    FORBIDDEN_BROWSER_NAV_GLOBALS.has(memberName) &&
    receiver !== undefined &&
    isSensitiveGlobalReceiver(receiver)
  ) {
    violations.push({
      filePath,
      rule: 'DYNAMIC_CODE_EVAL',
      detail: `Direct browser navigation via "${memberName}" is forbidden; use @baci/experience-sdk navigation`,
    });
  } else if (memberName === 'click' || memberName === 'submit') {
    violations.push({
      filePath,
      rule: 'DYNAMIC_CODE_EVAL',
      detail: `Imperative DOM "${memberName}" activation is forbidden; use declarative events or SDK navigation`,
    });
  } else if (
    memberName === 'assign' &&
    !isAllowedObjectAssignCall(memberAccessNode)
  ) {
    violations.push({
      filePath,
      rule: 'DANGEROUS_INNER_HTML',
      detail:
        'Unbounded .assign() mutation or navigation is forbidden; use object spread or SDK navigation',
    });
  } else if (
    memberName === 'createElement' ||
    memberName === 'createElementNS' ||
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
  } else if (
    FORBIDDEN_STORAGE_MEMBERS.has(memberName) ||
    ((memberName === 'caches' || memberName === 'storage') &&
      receiver !== undefined &&
      isSensitiveGlobalReceiver(receiver))
  ) {
    violations.push({
      filePath,
      rule: 'DIRECT_COOKIE_ACCESS',
      detail:
        'Custom storefronts are cookie/storage-free; use @baci/experience-sdk APIs',
    });
  }
}

/** Constant-folds string literals, templates, and `+` concatenations. */
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
