import ts from '@typescript/typescript6';
import {
  bindingContainsName,
  createVirtualComponentExportResolver,
  isDirectComponentExpr,
  resolveVirtualModule,
} from './jsx-export-graph';

const FORBIDDEN_INTRINSIC_JSX_TAGS: ReadonlySet<string> = new Set([
  'script',
  'object',
  'embed',
  'base',
  'applet',
  'link',
  'meta',
]);

type BindingKind = 'component' | 'motion' | 'unsafe';

function hasHoistedVarBinding(root: ts.Node, target: string): boolean {
  let found = false;
  const walk = (node: ts.Node): void => {
    if (found) return;
    if (
      node !== root &&
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node))
    ) {
      return;
    }
    if (
      ts.isVariableDeclarationList(node) &&
      (node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0
    ) {
      for (const d of node.declarations) {
        if (bindingContainsName(d.name, target)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(root);
  return found;
}

export function createJsxTagValidator(
  parsedFiles: ReadonlyMap<string, ts.SourceFile>
) {
  const getSafeComponentExports =
    createVirtualComponentExportResolver(parsedFiles);

  return (filePath: string, sf: ts.SourceFile) => {
    const importBindings = new Map<string, BindingKind>();
    for (const stmt of sf.statements) {
      if (
        ts.isImportDeclaration(stmt) &&
        stmt.importClause &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const spec = stmt.moduleSpecifier.text.trim();
        const clause = stmt.importClause;
        if (spec.startsWith('.')) {
          const resolved = resolveVirtualModule(filePath, spec, parsedFiles);
          const exp = resolved ? getSafeComponentExports(resolved) : new Set();
          if (clause.name) {
            importBindings.set(
              clause.name.text,
              exp.has('default') ? 'component' : 'unsafe'
            );
          }
          if (clause.namedBindings) {
            if (ts.isNamespaceImport(clause.namedBindings)) {
              importBindings.set(clause.namedBindings.name.text, 'unsafe');
            } else {
              for (const el of clause.namedBindings.elements) {
                importBindings.set(
                  el.name.text,
                  exp.has((el.propertyName ?? el.name).text)
                    ? 'component'
                    : 'unsafe'
                );
              }
            }
          }
        } else {
          if (clause.name) importBindings.set(clause.name.text, 'component');
          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              const orig = (el.propertyName ?? el.name).text;
              importBindings.set(
                el.name.text,
                spec === 'framer-motion' && orig === 'motion'
                  ? 'motion'
                  : /^[A-Z]/.test(orig)
                    ? 'component'
                    : 'unsafe'
              );
            }
          }
        }
      }
    }

    const resolveBindingAt = (
      atNode: ts.Node,
      target: string,
      depth = 0
    ): BindingKind => {
      if (depth > 8) return 'unsafe';
      let cur: ts.Node | undefined = atNode.parent;
      while (cur) {
        if (
          ts.isCatchClause(cur) &&
          cur.variableDeclaration &&
          bindingContainsName(cur.variableDeclaration.name, target)
        ) {
          return 'unsafe';
        }
        if (
          ts.isFunctionDeclaration(cur) ||
          ts.isFunctionExpression(cur) ||
          ts.isArrowFunction(cur) ||
          ts.isMethodDeclaration(cur) ||
          ts.isConstructorDeclaration(cur)
        ) {
          for (const p of cur.parameters) {
            if (bindingContainsName(p.name, target)) return 'unsafe';
          }
          if (hasHoistedVarBinding(cur, target)) return 'unsafe';
          if (ts.isFunctionExpression(cur) && cur.name?.text === target) {
            return 'component';
          }
        }
        if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
          if (ts.isSourceFile(cur) && hasHoistedVarBinding(cur, target)) {
            return 'unsafe';
          }
          for (const stmt of cur.statements) {
            if (ts.isVariableStatement(stmt)) {
              const isConst =
                (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
              for (const d of stmt.declarationList.declarations) {
                if (bindingContainsName(d.name, target)) {
                  return isConst &&
                    ts.isIdentifier(d.name) &&
                    d.initializer !== undefined &&
                    isDirectComponentExpr(
                      d.initializer,
                      (n) =>
                        n !== target &&
                        resolveBindingAt(d, n, depth + 1) === 'component'
                    )
                    ? 'component'
                    : 'unsafe';
                }
              }
            } else if (
              (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
              stmt.name?.text === target
            ) {
              return 'component';
            }
          }
          if (ts.isSourceFile(cur)) {
            return importBindings.get(target) ?? 'unsafe';
          }
        }
        cur = cur.parent;
      }
      return 'unsafe';
    };

    return (tagName: ts.JsxTagNameExpression): string | null => {
      if (ts.isIdentifier(tagName)) {
        const t = tagName.text;
        if (/^[a-z]/.test(t)) {
          return FORBIDDEN_INTRINSIC_JSX_TAGS.has(t)
            ? `Executable or document-level JSX element "<${t}>" is forbidden`
            : null;
        }
        return resolveBindingAt(tagName, t) === 'component'
          ? null
          : `JSX component "<${t}>" must reference a statically verified component function`;
      }
      if (
        ts.isPropertyAccessExpression(tagName) &&
        ts.isIdentifier(tagName.expression) &&
        resolveBindingAt(tagName, tagName.expression.text) === 'motion' &&
        /^[a-z][a-zA-Z0-9]*$/.test(tagName.name.text) &&
        !FORBIDDEN_INTRINSIC_JSX_TAGS.has(tagName.name.text)
      ) {
        return null;
      }
      return `Dynamic or unverified JSX member tag "<${tagName.getText(sf)}>" is forbidden`;
    };
  };
}
