import ts from '@typescript/typescript6';
import {
  DYNAMIC_CODE_NAMES,
  FORBIDDEN_BROWSER_CAPABILITY_GLOBALS,
  FORBIDDEN_BROWSER_NAV_GLOBALS,
  FORBIDDEN_STORAGE_MEMBERS,
  SAFE_NAVIGATOR_MEMBERS,
  SENSITIVE_GLOBAL_ROOTS,
} from './banned-specifiers';
import { resolveStaticString } from './const-string-fold';
import { hasLocalLexicalBinding } from './jsx-tag-safety';

export { hasLocalLexicalBinding, resolveStaticString };

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

function isNavigatorReceiver(expr: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
    return isNavigatorReceiver(expr.expression);
  }
  if (ts.isIdentifier(expr)) {
    return (
      expr.text === 'navigator' && !hasLocalLexicalBinding(expr, 'navigator')
    );
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return (
      expr.name.text === 'navigator' &&
      isSensitiveGlobalReceiver(expr.expression)
    );
  }
  if (ts.isElementAccessExpression(expr)) {
    return (
      resolveStaticString(expr.argumentExpression) === 'navigator' &&
      isSensitiveGlobalReceiver(expr.expression)
    );
  }
  return false;
}

function isSensitiveGlobalReceiver(expr: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) {
    return isSensitiveGlobalReceiver(expr.expression);
  }
  if (ts.isIdentifier(expr)) {
    return (
      SENSITIVE_GLOBAL_ROOTS.has(expr.text) &&
      !hasLocalLexicalBinding(expr, expr.text)
    );
  }
  if (
    ts.isCallExpression(expr) &&
    (ts.isPropertyAccessExpression(expr.expression) ||
      ts.isElementAccessExpression(expr.expression))
  ) {
    return isSensitiveGlobalReceiver(expr.expression.expression);
  }
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
  const push = (rule: SourceSafetyViolation['rule'], detail: string) =>
    violations.push({ filePath, rule, detail });
  const lowerMember = memberName.toLowerCase();
  const isUnsafeWrite =
    (memberName === 'write' || memberName === 'writeln') &&
    (memberAccessNode === undefined ||
      (memberAccessNode.parent !== undefined &&
        ts.isCallExpression(memberAccessNode.parent) &&
        memberAccessNode.parent.expression === memberAccessNode) ||
      (receiver !== undefined && isDocumentReceiver(receiver)));
  if (LOWERCASE_HTML_SINK_NAMES.has(lowerMember) || isUnsafeWrite) {
    push(
      'DANGEROUS_INNER_HTML',
      `Forbidden raw HTML or React element sink "${memberName}"`
    );
  } else if (
    FORBIDDEN_BROWSER_NAV_GLOBALS.has(memberName) &&
    receiver !== undefined &&
    isSensitiveGlobalReceiver(receiver)
  ) {
    push(
      'DYNAMIC_CODE_EVAL',
      `Direct browser navigation via "${memberName}" is forbidden; use @baci/experience-sdk navigation`
    );
  } else if (memberName === 'click' || memberName === 'submit') {
    push(
      'DYNAMIC_CODE_EVAL',
      `Imperative DOM "${memberName}" activation is forbidden; use declarative events or SDK navigation`
    );
  } else if (
    memberName === 'assign' &&
    !isAllowedObjectAssignCall(memberAccessNode)
  ) {
    push(
      'DANGEROUS_INNER_HTML',
      'Unbounded .assign() mutation or navigation is forbidden; use object spread or SDK navigation'
    );
  } else if (
    memberName === 'createElement' ||
    memberName === 'createElementNS' ||
    memberName === 'cloneElement' ||
    memberName === 'createFactory'
  ) {
    push(
      'DANGEROUS_INNER_HTML',
      `Direct React factory "${memberName}" is forbidden; use JSX syntax`
    );
  } else if (DYNAMIC_CODE_NAMES.has(memberName)) {
    push(
      'DYNAMIC_CODE_EVAL',
      `Dynamic code access via "${memberName}" is forbidden`
    );
  } else if (memberName === 'serviceWorker') {
    push(
      'SERVICE_WORKER_ACCESS',
      'Service Worker registration or control is forbidden on storefronts'
    );
  } else if (
    FORBIDDEN_STORAGE_MEMBERS.has(memberName) ||
    ((memberName === 'caches' || memberName === 'storage') &&
      receiver !== undefined &&
      isSensitiveGlobalReceiver(receiver))
  ) {
    push(
      'DIRECT_COOKIE_ACCESS',
      'Custom storefronts are cookie/storage-free; use @baci/experience-sdk APIs'
    );
  } else if (
    receiver !== undefined &&
    ((isNavigatorReceiver(receiver) &&
      !SAFE_NAVIGATOR_MEMBERS.has(memberName)) ||
      (isSensitiveGlobalReceiver(receiver) &&
        (FORBIDDEN_BROWSER_CAPABILITY_GLOBALS.has(memberName) ||
          memberName === 'valueOf' ||
          memberName === 'top' ||
          memberName === 'parent' ||
          memberName === 'frames')))
  ) {
    push(
      'DYNAMIC_CODE_EVAL',
      `Forbidden browser permission or capability API "${memberName}"`
    );
  }
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
      ts.isEnumMember(p) ||
      ts.isVariableDeclaration(p) ||
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
    (ts.isBindingElement(p) ||
      ts.isImportSpecifier(p) ||
      ts.isExportSpecifier(p)) &&
    (p.propertyName === node || p.name === node)
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
