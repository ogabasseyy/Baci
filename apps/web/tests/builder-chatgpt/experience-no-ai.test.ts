// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { expect, it } from 'vitest';

it('private approval and mode admission import closure has no AI provider or generator dependency', () => {
  const root = resolve(process.cwd(), 'src');
  const pending = [
    'instrumentation-experience-boot.ts',
    'lib/experience/draft-apply.ts',
    'lib/experience/approval-service.ts',
    'lib/experience/owner-approval-handler.ts',
    'lib/experience/legacy-execution.ts',
    'lib/experience/authoring-mode.ts',
    'lib/experience/owner-runtime.ts',
    'lib/experience/tool-dispatcher.ts',
    'lib/experience/compose-runtime.ts',
    'lib/experience/owner-lifecycle-runtime.ts',
    'lib/experience/independent-approval-verifier.ts',
    'lib/experience/private-capture-service.ts',
    'lib/experience/evidence-read.ts',
    'lib/experience/evidence-runtime.ts',
  ].map((p) => resolve(root, p));
  const visited = new Set<string>();
  while (pending.length) {
    const path = pending.pop();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    const text = readFileSync(path, 'utf8');
    const parsed = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true
    );
    const imports: string[] = [];
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        imports.push(node.arguments[0].text);
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        !(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push(node.moduleSpecifier.text);
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    for (const name of imports) {
      expect(name, `runtime import in ${path}`).not.toMatch(
        /(?:^ai$|@ai-sdk\/|genkit|openai|anthropic|gemini|materialize-builder-ai-provider|run-builder-ai-provider|generate-edit|provider-chain|generateStorefrontEdit)/i
      );
      const base = name.startsWith('@/')
        ? resolve(root, name.slice(2))
        : name.startsWith('.')
          ? resolve(dirname(path), name)
          : null;
      if (!base) continue;
      const found = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
      ].find((p) => existsSync(p) && statSync(p).isFile());
      expect(found, `unresolved ${name} from ${path}`).toBeTruthy();
      if (found) pending.push(found);
    }
  }
  expect(visited.size).toBeGreaterThan(6);
});
