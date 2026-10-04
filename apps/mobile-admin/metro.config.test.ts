import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type MetroConfig = {
  resolver: {
    blockList?: RegExp[];
  };
  serializer?: {
    customSerializer?: unknown;
  };
  watchFolders?: string[];
};

const require = createRequire(import.meta.url);
const metroConfig = require('./metro.config.js') as MetroConfig;

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

function isBlocked(filePath: string) {
  return (
    metroConfig.resolver.blockList?.some((pattern) => pattern.test(filePath)) ??
    false
  );
}

describe('Metro configuration', () => {
  it('watches root node_modules so pnpm hoisted dependencies resolve', () => {
    expect(metroConfig.watchFolders).toEqual(
      expect.arrayContaining([
        projectRoot,
        path.resolve(workspaceRoot, 'node_modules'),
        path.resolve(workspaceRoot, 'packages/shared'),
        path.resolve(workspaceRoot, 'packages/tiktok-business'),
      ])
    );
  });

  it('keeps the PostHog Metro serializer enabled for source-map debug ids', () => {
    expect(metroConfig.serializer?.customSerializer).toEqual(
      expect.any(Function)
    );
  });

  it('does not block pnpm virtual store packages', () => {
    const pnpmPackagePath = path.join(
      workspaceRoot,
      'node_modules',
      '.pnpm',
      'react@19.2.3',
      'node_modules',
      'react',
      'index.js'
    );

    expect(isBlocked(pnpmPackagePath)).toBe(false);
  });

  it('blocks massive directories that should not be crawled', () => {
    const blockedPaths = [
      path.join(workspaceRoot, '.git', 'objects', 'pack'),
      path.join(workspaceRoot, '.pnpm-store', 'v3'),
      path.join(workspaceRoot, 'apps', 'web', 'node_modules', 'react'),
    ];

    for (const blockedPath of blockedPaths) {
      expect(isBlocked(blockedPath)).toBe(true);
    }
  });

  it('detects side-effect dev-only imports', () => {
    expect(DEV_ONLY_IMPORT.test("import 'vitest'")).toBe(true);
    expect(DEV_ONLY_IMPORT.test("import 'vite'")).toBe(true);
    expect(DEV_ONLY_IMPORT.test("import('vitest')")).toBe(true);
    expect(DEV_ONLY_IMPORT.test("import ('vitest')")).toBe(true);
    expect(DEV_ONLY_IMPORT.test("require ('vitest')")).toBe(true);
  });

  it('keeps dev-only modules out of bundled route files', () => {
    // Regression guard: a vitest setup helper once lived directly under app/
    // where neither the *.test.* nor __tests__ blockList patterns excluded it,
    // breaking every release bundle. Test helpers belong in test/ or __tests__/.
    expect(findBundledDevImports(path.join(projectRoot, 'app'))).toEqual([]);
  });
});

const DEV_ONLY_IMPORT =
  /(?:from|import\s*(?:\(\s*)?)\s*['"](?:vitest|vite)['"]|require\s*\(\s*['"](?:vitest|vite)['"]/;

function findBundledDevImports(dir: string): string[] {
  const offenders: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!isBlocked(fullPath + path.sep)) {
        offenders.push(...findBundledDevImports(fullPath));
      }
      continue;
    }

    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || isBlocked(fullPath)) {
      continue;
    }

    if (DEV_ONLY_IMPORT.test(readFileSync(fullPath, 'utf8'))) {
      offenders.push(path.relative(projectRoot, fullPath));
    }
  }

  return offenders;
}
