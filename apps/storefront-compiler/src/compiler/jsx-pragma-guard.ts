import ts from '@typescript/typescript6';
import { JSX_RUNTIME_VIRTUAL_PATH } from './jsx-runtime-guard';
import type { SourceSafetyViolation } from './source-guard-ast';

const FORBIDDEN_JSX_PRAGMA_RE =
  /@(?:jsx|jsxFrag|jsxImportSource|jsxRuntime)\b/i;

const TRUSTED_JSX_RUNTIME_HEADERS: ReadonlySet<string> = new Set([
  `source:${JSX_RUNTIME_VIRTUAL_PATH}`,
  `baci-virtual:${JSX_RUNTIME_VIRTUAL_PATH}`,
]);

function hasKeyAfterSpread(attrs: ts.JsxAttributes): boolean {
  let seenSpread = false;
  for (const prop of attrs.properties) {
    if (ts.isJsxSpreadAttribute(prop)) {
      seenSpread = true;
    } else if (
      seenSpread &&
      ts.isJsxAttribute(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'key'
    ) {
      return true;
    }
  }
  return false;
}

export function checkJsxPragmaComments(
  sourceFile: ts.SourceFile,
  filePath: string,
  violations: SourceSafetyViolation[]
): void {
  const text = sourceFile.getFullText();
  const seenOffsets = new Set<number>();
  let foundPragma = false;
  let foundKeyAfterSpread = false;
  const checkRanges = (ranges: readonly ts.CommentRange[] | undefined) => {
    if (!ranges || foundPragma) return;
    for (const r of ranges) {
      if (seenOffsets.has(r.pos)) continue;
      seenOffsets.add(r.pos);
      if (FORBIDDEN_JSX_PRAGMA_RE.test(text.slice(r.pos, r.end))) {
        foundPragma = true;
        violations.push({
          filePath,
          rule: 'DANGEROUS_INNER_HTML',
          detail:
            'JSX compiler pragma is forbidden; storefronts must use the guarded automatic JSX runtime',
        });
        return;
      }
    }
  };
  const walk = (n: ts.Node): void => {
    if (
      n.kind !== ts.SyntaxKind.JsxText &&
      n.kind !== ts.SyntaxKind.JsxTextAllWhiteSpaces
    ) {
      checkRanges(ts.getLeadingCommentRanges(text, n.getFullStart()));
      checkRanges(ts.getTrailingCommentRanges(text, n.getEnd()));
    }
    if (
      !foundKeyAfterSpread &&
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      hasKeyAfterSpread(n.attributes)
    ) {
      foundKeyAfterSpread = true;
      violations.push({
        filePath,
        rule: 'DANGEROUS_INNER_HTML',
        detail:
          'JSX key attribute after spread is forbidden; place key before spread attributes so the guarded automatic JSX runtime is used',
      });
    }
    ts.forEachChild(n, walk);
  };
  walk(sourceFile);
}

function isMerchantSourceHeader(header: string): boolean {
  if (TRUSTED_JSX_RUNTIME_HEADERS.has(header)) return false;
  return header.startsWith('source:') || header.startsWith('baci-virtual:');
}

export function assertPrebundledOutputUsesGuardedJsxRuntime(
  outputText: string
): boolean {
  const sf = ts.createSourceFile(
    'prebundle.js',
    outputText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const forbiddenLocals = new Set<string>(['createElement', 'createFactory']);
  for (const stmt of sf.statements) {
    if (stmt.kind === ts.SyntaxKind.ImportDeclaration) {
      const imp = stmt as ts.ImportDeclaration;
      const named = imp.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          const orig = (el.propertyName ?? el.name).text;
          if (orig === 'createElement' || orig === 'createFactory') {
            forbiddenLocals.add(el.name.text);
          }
        }
      }
    }
  }

  let inMerchantSource = false;
  for (const stmt of sf.statements) {
    const ranges = ts.getLeadingCommentRanges(outputText, stmt.getFullStart());
    if (ranges) {
      for (const r of ranges) {
        if (r.kind !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
        const raw = outputText.slice(r.pos, r.end);
        if (raw.startsWith('// ')) {
          inMerchantSource = isMerchantSourceHeader(raw.slice(3).trim());
        }
      }
    }
    if (!inMerchantSource) continue;

    let escaped = false;
    const walk = (n: ts.Node): void => {
      if (escaped) return;
      if (
        ts.isImportSpecifier(n) &&
        ((n.propertyName ?? n.name).text === 'createElement' ||
          (n.propertyName ?? n.name).text === 'createFactory')
      ) {
        escaped = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(n) &&
        (n.name.text === 'createElement' || n.name.text === 'createFactory')
      ) {
        escaped = true;
        return;
      }
      if (
        ts.isElementAccessExpression(n) &&
        ts.isStringLiteralLike(n.argumentExpression) &&
        (n.argumentExpression.text === 'createElement' ||
          n.argumentExpression.text === 'createFactory')
      ) {
        escaped = true;
        return;
      }
      if (ts.isIdentifier(n) && forbiddenLocals.has(n.text)) {
        escaped = true;
        return;
      }
      ts.forEachChild(n, walk);
    };
    walk(stmt);
    if (escaped) return false;
  }
  return true;
}
