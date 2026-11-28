import ts from '@typescript/typescript6';
import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';
import {
  BANNED_MERCHANT_SUBPATH_SPECIFIERS,
  BENIGN_OBJECT_DATA_KEYS,
  FORBIDDEN_BROWSER_CAPABILITY_GLOBALS,
  FORBIDDEN_BROWSER_NAV_GLOBALS,
  FORBIDDEN_STORAGE_GLOBALS,
  isProhibitedImportSpecifier,
  SENSITIVE_GLOBAL_ROOTS,
} from './banned-specifiers';
import { createVirtualComponentExportResolver } from './jsx-export-graph';
import { checkFormElementSafety } from './jsx-form-safety';
import {
  checkJsxAttributeSafety,
  checkJsxSpreadAttributeSafety,
} from './jsx-nav-safety';
import { createJsxTagValidator } from './jsx-tag-safety';
import { checkDynamicImportOrRequireNode } from './module-call-guard';
import { checkOpenDestructuringSafety } from './open-binding-guard';
import { createSdkOpenReceiverChecker } from './sdk-binding-resolver';
import {
  classifyMemberName,
  hasLocalLexicalBinding,
  isAllowedSensitiveRootPosition,
  isPropertyOrDeclarationName,
  resolveStaticString,
  type SourceSafetyViolation,
} from './source-guard-ast';
import { checkBrowserGlobalSsrSafety } from './ssr-browser-global-guard';

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
  const declaredAssetIds = new Set(manifest.assets.map((a) => a.assetId));
  const resolveSafeExports = createVirtualComponentExportResolver(parsedFiles);
  if (!resolveSafeExports(manifest.entry).has('default')) {
    violations.push({
      filePath: manifest.entry,
      rule: 'DANGEROUS_INNER_HTML',
      detail: `Manifest entry "${manifest.entry}" must export a valid default React component`,
    });
  }
  const buildFileJsxChecker = createJsxTagValidator(parsedFiles);
  const buildSdkOpenChecker = createSdkOpenReceiverChecker(parsedFiles);

  for (const [filePath, sourceFile] of parsedFiles.entries()) {
    const { checkJsxTag, isSdkLinkTag } = buildFileJsxChecker(
      filePath,
      sourceFile
    );
    const isSdkOpenReceiver = buildSdkOpenChecker(filePath, sourceFile);
    const jsxEnv = {
      filePath,
      merchantSlug: manifest.merchantSlug,
      hostOrigin: manifest.hostOrigin,
      declaredAssetIds,
      isSdkLinkTag,
      violations,
    };
    const fail = (
      rule: SourceSafetyViolation['rule'],
      detail: string
    ): void => {
      violations.push({ filePath, rule, detail });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isTypeNode(node)) {
        if (
          ts.isExpressionWithTypeArguments(node) &&
          ts.isHeritageClause(node.parent) &&
          node.parent.token === ts.SyntaxKind.ExtendsKeyword &&
          (ts.isClassDeclaration(node.parent.parent) ||
            ts.isClassExpression(node.parent.parent))
        ) {
          visit(node.expression);
        }
        return;
      }
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
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
        fail(
          'PROHIBITED_RUNTIME_IMPORT',
          `Prohibited runtime specifier "${node.moduleSpecifier.text}"`
        );
      }
      checkDynamicImportOrRequireNode(node, filePath, violations);
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const jsxError = checkJsxTag(node.tagName);
        if (jsxError !== null) fail('DANGEROUS_INNER_HTML', jsxError);
        checkFormElementSafety(jsxEnv, node, sourceFile);
      }
      if (ts.isJsxAttribute(node))
        checkJsxAttributeSafety(jsxEnv, node, sourceFile);
      if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) {
        classifyMemberName(
          filePath,
          (node.propertyName ?? node.name).text,
          violations
        );
      }
      if (ts.isJsxSpreadAttribute(node))
        checkJsxSpreadAttributeSafety(jsxEnv, node);

      if (
        ts.isPropertyAssignment(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)
      ) {
        const isSpreadProp =
          ts.isPropertyAssignment(node) &&
          ts.isObjectLiteralExpression(node.parent) &&
          ts.isJsxSpreadAttribute(node.parent.parent);
        if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
          const isBenignKey =
            ts.isPropertyAssignment(node) &&
            BENIGN_OBJECT_DATA_KEYS.has(node.name.text);
          if (!isBenignKey && !isSpreadProp) {
            classifyMemberName(filePath, node.name.text, violations);
          }
        } else if (ts.isComputedPropertyName(node.name)) {
          const folded = resolveStaticString(node.name.expression);
          if (folded !== null) {
            if (!isSpreadProp) classifyMemberName(filePath, folded, violations);
          } else {
            fail(
              'DYNAMIC_CODE_EVAL',
              'Unresolvable computed object property key is forbidden'
            );
          }
        }
      }

      if (ts.isBindingElement(node)) {
        const keyNode = node.propertyName ?? node.name;
        if (ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode)) {
          classifyMemberName(filePath, keyNode.text, violations);
        } else if (ts.isComputedPropertyName(keyNode)) {
          const folded = resolveStaticString(keyNode.expression);
          if (folded !== null) {
            classifyMemberName(filePath, folded, violations);
          } else {
            fail(
              'DYNAMIC_CODE_EVAL',
              'Unresolvable computed destructuring key is forbidden'
            );
          }
        }
      }

      if (
        ts.isShorthandPropertyAssignment(node) ||
        ts.isPropertyAccessExpression(node)
      ) {
        classifyMemberName(
          filePath,
          node.name.text,
          violations,
          ts.isPropertyAccessExpression(node) ? node.expression : undefined,
          ts.isPropertyAccessExpression(node) ? node : undefined,
          isSdkOpenReceiver
        );
        if (
          ts.isPropertyAccessExpression(node) &&
          SENSITIVE_GLOBAL_ROOTS.has(node.name.text) &&
          !isAllowedSensitiveRootPosition(node)
        ) {
          fail(
            'DYNAMIC_CODE_EVAL',
            `Aliasing or passing sensitive global "${node.name.text}" is forbidden`
          );
        }
      }

      if (ts.isElementAccessExpression(node)) {
        if (!ts.isNumericLiteral(node.argumentExpression)) {
          const folded = resolveStaticString(node.argumentExpression);
          if (folded !== null) {
            classifyMemberName(
              filePath,
              folded,
              violations,
              node.expression,
              node,
              isSdkOpenReceiver
            );
            if (
              SENSITIVE_GLOBAL_ROOTS.has(folded) &&
              !isAllowedSensitiveRootPosition(node)
            ) {
              fail(
                'DYNAMIC_CODE_EVAL',
                `Aliasing or passing sensitive global "${folded}" is forbidden`
              );
            }
          } else {
            fail(
              'DYNAMIC_CODE_EVAL',
              'Non-literal bracket indexing is forbidden; use .at() or static keys'
            );
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
          fail(
            'DYNAMIC_CODE_EVAL',
            `Direct reference to "${node.text}" is forbidden`
          );
        } else if (
          FORBIDDEN_STORAGE_GLOBALS.has(node.text) &&
          !hasLocalLexicalBinding(node, node.text)
        ) {
          fail(
            'DIRECT_COOKIE_ACCESS',
            `Direct browser storage/cookie access via "${node.text}" is forbidden; use @baci/experience-sdk`
          );
        } else if (
          (FORBIDDEN_BROWSER_NAV_GLOBALS.has(node.text) ||
            FORBIDDEN_BROWSER_CAPABILITY_GLOBALS.has(node.text)) &&
          !hasLocalLexicalBinding(node, node.text)
        ) {
          fail(
            'DYNAMIC_CODE_EVAL',
            `Direct browser navigation or capability via "${node.text}" is forbidden; use @baci/experience-sdk`
          );
        } else if (
          SENSITIVE_GLOBAL_ROOTS.has(node.text) &&
          !hasLocalLexicalBinding(node, node.text) &&
          !isAllowedSensitiveRootPosition(node)
        ) {
          fail(
            'DYNAMIC_CODE_EVAL',
            `Aliasing or passing sensitive global "${node.text}" is forbidden`
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    checkOpenDestructuringSafety(
      sourceFile,
      filePath,
      violations,
      isSdkOpenReceiver.isCommerceRoot
    );
    checkBrowserGlobalSsrSafety(sourceFile, filePath, violations);
  }
  return violations;
}
