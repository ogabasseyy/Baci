import ts from '@typescript/typescript6';

export function parseEventPipelineTypeScriptSource(
  path: string,
  source: string
): ts.SourceFile {
  const extension = path.toLowerCase().split('.').pop();
  const scriptKind =
    extension === 'tsx'
      ? ts.ScriptKind.TSX
      : extension === 'jsx'
        ? ts.ScriptKind.JSX
        : ['js', 'mjs', 'cjs'].includes(extension ?? '')
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
}
