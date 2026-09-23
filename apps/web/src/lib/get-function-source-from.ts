import { createRequire } from 'node:module';
import type * as TypeScript from '@typescript/typescript6';

const require = createRequire(import.meta.url);
const ts = require('@typescript/typescript6') as typeof TypeScript;

/** Slice a named function declaration from a TypeScript source file. */
export function getFunctionSourceFrom(
  functionName: string,
  source: string,
  sourceFile: TypeScript.SourceFile
): string {
  let match: TypeScript.FunctionDeclaration | undefined;

  function visit(node: TypeScript.Node): void {
    if (match) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (!match) {
    throw new Error(
      `Unable to locate ${functionName} in ${sourceFile.fileName}`
    );
  }

  return source.slice(match.getStart(sourceFile), match.end);
}
