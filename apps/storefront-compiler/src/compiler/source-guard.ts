import ts from '@typescript/typescript6';
import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';
import {
  DYNAMIC_CODE_NAMES,
  isProhibitedImportSpecifier,
  SENSITIVE_GLOBAL_ROOTS,
} from './banned-specifiers';
import {
  isAllowedSensitiveRootPosition,
  isPropertyOrDeclarationName,
  resolveStaticString,
} from './source-guard-ast';

export { isProhibitedImportSpecifier };

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

function scriptKindForPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function classifyMemberName(
  filePath: string,
  memberName: string,
  violations: SourceSafetyViolation[]
): void {
  if (memberName === 'dangerouslySetInnerHTML' || memberName === '__html') {
    violations.push({
      filePath,
      rule: 'DANGEROUS_INNER_HTML',
      detail: `Forbidden raw HTML property "${memberName}"`,
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

export function scanManifestSourceSafety(
  manifest: WorkerStorefrontManifest
): SourceSafetyViolation[] {
  const violations: SourceSafetyViolation[] = [];

  for (const file of manifest.files) {
    if (file.path.endsWith('.css')) continue;

    const sourceFile = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(file.path)
    );

    const visit = (node: ts.Node): void => {
      if (
        ts.isTypeNode(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)
      ) {
        return;
      }

      if (ts.isConstructorDeclaration(node)) {
        ts.forEachChild(node, visit);
        return;
      }

      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isProhibitedImportSpecifier(node.moduleSpecifier.text)
      ) {
        violations.push({
          filePath: file.path,
          rule: 'PROHIBITED_RUNTIME_IMPORT',
          detail: `Prohibited runtime specifier "${node.moduleSpecifier.text}"`,
        });
      }

      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const spec = node.arguments[0]
          ? resolveStaticString(node.arguments[0])
          : null;
        if (spec === null) {
          violations.push({
            filePath: file.path,
            rule: 'DYNAMIC_CODE_EVAL',
            detail: 'Non-literal dynamic import() is forbidden',
          });
        } else if (isProhibitedImportSpecifier(spec)) {
          violations.push({
            filePath: file.path,
            rule: 'PROHIBITED_RUNTIME_IMPORT',
            detail: `Prohibited runtime specifier "${spec}"`,
          });
        }
      }

      if (ts.isJsxAttribute(node)) {
        classifyMemberName(
          file.path,
          node.name.getText(sourceFile),
          violations
        );
      }

      if (
        ts.isPropertyAssignment(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)
      ) {
        if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
          const isBenignObjectDataKey =
            ts.isPropertyAssignment(node) &&
            (node.name.text === 'constructor' ||
              node.name.text === 'cookie' ||
              node.name.text === 'serviceWorker');
          if (!isBenignObjectDataKey) {
            classifyMemberName(file.path, node.name.text, violations);
          }
        } else if (ts.isComputedPropertyName(node.name)) {
          const folded = resolveStaticString(node.name.expression);
          if (folded !== null) {
            classifyMemberName(file.path, folded, violations);
          } else {
            violations.push({
              filePath: file.path,
              rule: 'DYNAMIC_CODE_EVAL',
              detail: 'Unresolvable computed object property key is forbidden',
            });
          }
        }
      }

      if (ts.isBindingElement(node)) {
        const keyNode = node.propertyName ?? node.name;
        if (ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode)) {
          classifyMemberName(file.path, keyNode.text, violations);
        } else if (ts.isComputedPropertyName(keyNode)) {
          const folded = resolveStaticString(keyNode.expression);
          if (folded !== null) {
            classifyMemberName(file.path, folded, violations);
          } else {
            violations.push({
              filePath: file.path,
              rule: 'DYNAMIC_CODE_EVAL',
              detail: 'Unresolvable computed destructuring key is forbidden',
            });
          }
        }
      }

      if (
        ts.isShorthandPropertyAssignment(node) ||
        ts.isPropertyAccessExpression(node)
      ) {
        classifyMemberName(file.path, node.name.text, violations);
      }

      if (ts.isElementAccessExpression(node)) {
        if (!ts.isNumericLiteral(node.argumentExpression)) {
          const folded = resolveStaticString(node.argumentExpression);
          if (folded !== null) {
            classifyMemberName(file.path, folded, violations);
          } else {
            violations.push({
              filePath: file.path,
              rule: 'DYNAMIC_CODE_EVAL',
              detail:
                'Non-literal bracket indexing is forbidden; use .at() or static keys',
            });
          }
        }
      }

      if (ts.isIdentifier(node) && !isPropertyOrDeclarationName(node)) {
        if (node.text === 'eval' || node.text === 'Function') {
          violations.push({
            filePath: file.path,
            rule: 'DYNAMIC_CODE_EVAL',
            detail: `Direct reference to "${node.text}" is forbidden`,
          });
        } else if (node.text === 'cookieStore') {
          violations.push({
            filePath: file.path,
            rule: 'DIRECT_COOKIE_ACCESS',
            detail:
              'Custom storefronts are cookie-free; use @baci/experience-sdk cart APIs',
          });
        } else if (
          SENSITIVE_GLOBAL_ROOTS.has(node.text) &&
          !isAllowedSensitiveRootPosition(node)
        ) {
          violations.push({
            filePath: file.path,
            rule: 'DYNAMIC_CODE_EVAL',
            detail: `Aliasing or passing sensitive global "${node.text}" is forbidden`,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return violations;
}
