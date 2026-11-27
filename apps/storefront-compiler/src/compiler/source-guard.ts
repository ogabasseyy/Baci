import ts from '@typescript/typescript6';
import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';
import {
  BANNED_MERCHANT_SUBPATH_SPECIFIERS,
  isProhibitedImportSpecifier,
  SENSITIVE_GLOBAL_ROOTS,
} from './banned-specifiers';
import { createJsxTagValidator } from './jsx-tag-safety';
import {
  classifyMemberName,
  isAllowedSensitiveRootPosition,
  isPropertyOrDeclarationName,
  resolveStaticString,
  type SourceSafetyViolation,
} from './source-guard-ast';

export { isProhibitedImportSpecifier, type SourceSafetyViolation };

function scriptKindForPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function scanManifestSourceSafety(
  manifest: WorkerStorefrontManifest
): SourceSafetyViolation[] {
  const violations: SourceSafetyViolation[] = [];
  const parsedFiles = new Map<string, ts.SourceFile>();

  for (const file of manifest.files) {
    if (file.path.endsWith('.css')) continue;
    parsedFiles.set(
      file.path,
      ts.createSourceFile(
        file.path,
        file.content,
        ts.ScriptTarget.Latest,
        true,
        scriptKindForPath(file.path)
      )
    );
  }
  const buildFileJsxChecker = createJsxTagValidator(parsedFiles);

  for (const [filePath, sourceFile] of parsedFiles.entries()) {
    const checkJsxTag = buildFileJsxChecker(filePath, sourceFile);
    const file = { path: filePath };

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
        (isProhibitedImportSpecifier(node.moduleSpecifier.text) ||
          BANNED_MERCHANT_SUBPATH_SPECIFIERS.has(
            node.moduleSpecifier.text.trim()
          ))
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
        } else if (
          isProhibitedImportSpecifier(spec) ||
          BANNED_MERCHANT_SUBPATH_SPECIFIERS.has(spec.trim())
        ) {
          violations.push({
            filePath: file.path,
            rule: 'PROHIBITED_RUNTIME_IMPORT',
            detail: `Prohibited runtime specifier "${spec}"`,
          });
        }
      }

      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const jsxError = checkJsxTag(node.tagName);
        if (jsxError !== null) {
          violations.push({
            filePath: file.path,
            rule: 'DANGEROUS_INNER_HTML',
            detail: jsxError,
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

      if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) {
        const specName = (node.propertyName ?? node.name).text;
        classifyMemberName(file.path, specName, violations);
      }

      if (ts.isJsxSpreadAttribute(node)) {
        const isSafeStaticLiteral =
          ts.isObjectLiteralExpression(node.expression) &&
          node.expression.properties.every(
            (p) =>
              ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)
          );
        if (!isSafeStaticLiteral) {
          violations.push({
            filePath: file.path,
            rule: 'DANGEROUS_INNER_HTML',
            detail:
              'Non-static JSX spread attributes are forbidden; pass explicit props',
          });
        }
      }

      if (
        ts.isPropertyAssignment(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)
      ) {
        if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
          const isBenignObjectDataKey =
            ts.isPropertyAssignment(node) &&
            (node.name.text === 'assign' ||
              node.name.text === 'write' ||
              node.name.text === 'writeln' ||
              node.name.text === 'constructor' ||
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
        classifyMemberName(
          file.path,
          node.name.text,
          violations,
          ts.isPropertyAccessExpression(node) ? node.expression : undefined,
          ts.isPropertyAccessExpression(node) ? node : undefined
        );
        if (
          ts.isPropertyAccessExpression(node) &&
          SENSITIVE_GLOBAL_ROOTS.has(node.name.text) &&
          !isAllowedSensitiveRootPosition(node)
        ) {
          violations.push({
            filePath: file.path,
            rule: 'DYNAMIC_CODE_EVAL',
            detail: `Aliasing or passing sensitive global "${node.name.text}" is forbidden`,
          });
        }
      }

      if (ts.isElementAccessExpression(node)) {
        if (!ts.isNumericLiteral(node.argumentExpression)) {
          const folded = resolveStaticString(node.argumentExpression);
          if (folded !== null) {
            classifyMemberName(
              file.path,
              folded,
              violations,
              node.expression,
              node
            );
            if (
              SENSITIVE_GLOBAL_ROOTS.has(folded) &&
              !isAllowedSensitiveRootPosition(node)
            ) {
              violations.push({
                filePath: file.path,
                rule: 'DYNAMIC_CODE_EVAL',
                detail: `Aliasing or passing sensitive global "${folded}" is forbidden`,
              });
            }
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
        if (
          node.text === 'eval' ||
          node.text === 'Function' ||
          node.text === 'Reflect' ||
          node.text === 'Proxy'
        ) {
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
