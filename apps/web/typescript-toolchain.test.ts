import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const workspaceRoot = resolve(process.cwd(), '../..');

describe('TypeScript toolchain packages', () => {
  it('keeps the TypeScript 6 API package separate from the TypeScript 7 CLI', () => {
    const workspacePackage = require(
      resolve(workspaceRoot, 'package.json')
    ) as {
      devDependencies: Record<string, string>;
    };
    const webPackage = require(resolve(process.cwd(), 'package.json')) as {
      devDependencies: Record<string, string>;
    };

    expect(workspacePackage.devDependencies.typescript).toMatch(
      /^npm:@typescript\/typescript6@~6\./
    );
    expect(workspacePackage.devDependencies['@typescript/typescript6']).toMatch(
      /^~6\./
    );
    expect(webPackage.devDependencies.typescript).toMatch(/^~7\./);
    expect(webPackage.devDependencies['@typescript/typescript6']).toMatch(
      /^~6\./
    );
  });
});
