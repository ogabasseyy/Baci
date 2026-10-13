import ts from '@typescript/typescript6';
import { isTestSourcePath } from './event-pipeline-source-path';

const sourceExtension = '(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)';
const appEntrypoint =
  '(?:apple-icon|default|error|forbidden|global-error|global-not-found|icon|layout|loading|manifest|not-found|opengraph-image|page|robots|route|sitemap|template|twitter-image|unauthorized)';
const appEntrypointPattern = new RegExp(
  `^apps/web/(?:src/)?app/(?:.+/)?${appEntrypoint}\\.${sourceExtension}$`
);
const requestEntrypointPattern = new RegExp(
  `^apps/web/(?:src/)?(?:instrumentation|instrumentation-client|mdx-components|middleware|proxy)\\.${sourceExtension}$`
);
const pagesEntrypointPattern = new RegExp(
  `^apps/web/(?:src/)?pages/.+\\.${sourceExtension}$`
);

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:cjs|js|mjs)$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function hasUseServerDirective(path: string, source: string): boolean {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path)
  );
  for (const statement of file.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

function isIndependent(path: string, source: string): boolean {
  if (isTestSourcePath(path) || /\.d\.[^.]+$/.test(path)) return false;
  return (
    appEntrypointPattern.test(path) ||
    requestEntrypointPattern.test(path) ||
    pagesEntrypointPattern.test(path) ||
    hasUseServerDirective(path, source)
  );
}

export const eventPipelineProductionSurface = { isIndependent } as const;
