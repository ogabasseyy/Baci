import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'esbuild';
import {
  BANNED_MERCHANT_SUBPATH_SPECIFIERS,
  isProhibitedImportSpecifier,
} from './banned-specifiers';

function resolveCompilerPackageRoot(startDir: string): string {
  let currentDir = path.resolve(startDir);
  while (currentDir !== path.dirname(currentDir)) {
    try {
      const parsed = JSON.parse(
        readFileSync(path.join(currentDir, 'package.json'), 'utf8')
      ) as { name?: unknown };
      if (parsed.name === '@baci/storefront-compiler') {
        return currentDir;
      }
    } catch {
      // Keep walking parent directories until @baci/storefront-compiler/package.json is located.
    }
    currentDir = path.dirname(currentDir);
  }
  return path.resolve(startDir, '../..');
}

export const COMPILER_ROOT = resolveCompilerPackageRoot(import.meta.dirname);

const PINNED_PACKAGE_ALLOWLIST: ReadonlySet<string> = new Set([
  'react',
  'react-dom',
  'scheduler',
  '@baci/experience-sdk',
  '@baci/shared',
  '@noble/hashes',
  'framer-motion',
  'motion-dom',
  'motion-utils',
  'tslib',
  'zod',
]);

export class StorefrontCompilerError extends Error {
  public readonly code:
    | 'INVALID_MANIFEST'
    | 'GRAPH_ESCAPE_BLOCKED'
    | 'BUDGET_EXCEEDED';

  constructor(code: StorefrontCompilerError['code'], message: string) {
    super(message);
    this.name = 'StorefrontCompilerError';
    this.code = code;
  }
}

function resolveOwningPackageName(resolvedFilePath: string): string {
  let currentDir = path.dirname(realpathSync(resolvedFilePath));
  while (currentDir !== path.dirname(currentDir)) {
    const pkgJsonPath = path.join(currentDir, 'package.json');
    try {
      const parsed = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
        name?: unknown;
      };
      if (typeof parsed.name === 'string' && parsed.name.length > 0) {
        return parsed.name;
      }
    } catch {
      // Keep walking parent directories until owning package.json is located.
    }
    currentDir = path.dirname(currentDir);
  }
  throw new StorefrontCompilerError(
    'GRAPH_ESCAPE_BLOCKED',
    'Resolved module does not belong to a pinned workspace package'
  );
}

export function createClosedStorefrontGraphPlugin(options: {
  virtualFiles: ReadonlyMap<string, string>;
  declaredPackages: ReadonlySet<string>;
  declaredAssetIds: ReadonlySet<string>;
  externalSingletons?: ReadonlySet<string>;
}): Plugin {
  const {
    virtualFiles,
    declaredPackages,
    declaredAssetIds,
    externalSingletons,
  } = options;

  return {
    name: 'closed-storefront-graph',
    setup(buildCtx) {
      buildCtx.onResolve({ filter: /.*/ }, (args) => {
        if (args.pluginData?.platformResolution) return undefined;

        if (args.kind === 'entry-point') {
          return { path: args.path, namespace: 'source' };
        }

        if (isProhibitedImportSpecifier(args.path)) {
          throw new StorefrontCompilerError(
            'GRAPH_ESCAPE_BLOCKED',
            `Prohibited runtime specifier: "${args.path}"`
          );
        }

        if (args.namespace === 'source' && args.path.startsWith('.')) {
          const normalized = path.posix.normalize(
            path.posix.join(path.posix.dirname(args.importer), args.path)
          );
          if (normalized.startsWith('../') || normalized.startsWith('/')) {
            throw new StorefrontCompilerError(
              'GRAPH_ESCAPE_BLOCKED',
              `Relative import escapes virtual source root: "${args.path}"`
            );
          }
          const suffixes = [
            '',
            '.tsx',
            '.ts',
            '.jsx',
            '.js',
            '.css',
            '/index.tsx',
            '/index.ts',
            '/index.jsx',
            '/index.js',
          ];
          const matched = suffixes
            .map((suffix) => `${normalized}${suffix}`)
            .find((candidate) => virtualFiles.has(candidate));
          if (!matched) {
            throw new StorefrontCompilerError(
              'GRAPH_ESCAPE_BLOCKED',
              `Unresolved virtual storefront import: "${args.path}"`
            );
          }
          return { path: matched, namespace: 'source' };
        }

        if (args.kind === 'url-token') {
          if (args.path.startsWith('/assets/')) {
            const assetId = args.path.slice('/assets/'.length);
            if (declaredAssetIds.has(assetId)) {
              return { path: args.path, external: true };
            }
          }
          throw new StorefrontCompilerError(
            'GRAPH_ESCAPE_BLOCKED',
            `Undeclared asset URL token: "${args.path}"`
          );
        }

        if (
          args.path.startsWith('/') ||
          args.path.includes(':') ||
          args.path.includes('\\') ||
          (args.namespace === 'source' && args.path.includes('..'))
        ) {
          throw new StorefrontCompilerError(
            'GRAPH_ESCAPE_BLOCKED',
            `Host or URL import denied: "${args.path}"`
          );
        }

        if (args.namespace === 'singleton-cjs') {
          return { path: args.path, external: true };
        }

        if (
          args.namespace === 'source' &&
          !args.importer.startsWith('__baci_')
        ) {
          if (BANNED_MERCHANT_SUBPATH_SPECIFIERS.has(args.path.trim())) {
            throw new StorefrontCompilerError(
              'GRAPH_ESCAPE_BLOCKED',
              `Prohibited merchant subpath specifier: "${args.path}"`
            );
          }
          const packageRoot = args.path.startsWith('@')
            ? args.path.split('/').slice(0, 2).join('/')
            : (args.path.split('/')[0] ?? '');
          if (!declaredPackages.has(packageRoot)) {
            throw new StorefrontCompilerError(
              'GRAPH_ESCAPE_BLOCKED',
              `Undeclared package "${packageRoot}" (must be listed in manifest.packages)`
            );
          }
        }

        const resolvedRoot = args.path.startsWith('@')
          ? args.path.split('/').slice(0, 2).join('/')
          : (args.path.split('/')[0] ?? '');
        if (externalSingletons?.has(resolvedRoot)) {
          return args.kind === 'require-call'
            ? { path: args.path, namespace: 'singleton-cjs' }
            : { path: args.path, external: true };
        }

        return buildCtx.resolve(args.path, {
          resolveDir: args.resolveDir || COMPILER_ROOT,
          kind: args.kind,
          pluginData: { platformResolution: true },
        });
      });

      buildCtx.onLoad({ filter: /.*/, namespace: 'source' }, (args) => {
        const contents = virtualFiles.get(args.path);
        if (contents === undefined) {
          throw new StorefrontCompilerError(
            'GRAPH_ESCAPE_BLOCKED',
            `Missing virtual source file: "${args.path}"`
          );
        }
        if (args.path.endsWith('.css')) {
          return { contents: '', loader: 'js' };
        }
        const ext = path.posix.extname(args.path).slice(1);
        if (!['tsx', 'ts', 'jsx', 'js'].includes(ext)) {
          throw new StorefrontCompilerError(
            'GRAPH_ESCAPE_BLOCKED',
            `Unsupported source extension: "${ext}"`
          );
        }
        return {
          contents,
          loader: ext as 'tsx' | 'ts' | 'jsx' | 'js',
          resolveDir: COMPILER_ROOT,
        };
      });

      buildCtx.onLoad({ filter: /.*/, namespace: 'singleton-cjs' }, (args) => ({
        contents: `import * as __ns from ${JSON.stringify(args.path)};\nmodule.exports = 'default' in __ns && __ns.default && typeof __ns.default === 'object' ? Object.assign({}, __ns.default, __ns) : __ns;\n`,
        loader: 'js',
        resolveDir: COMPILER_ROOT,
      }));

      buildCtx.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
        const pkgName = resolveOwningPackageName(args.path);
        if (!PINNED_PACKAGE_ALLOWLIST.has(pkgName)) {
          throw new StorefrontCompilerError(
            'GRAPH_ESCAPE_BLOCKED',
            `Transitive package "${pkgName}" is not in the pinned platform allowlist`
          );
        }
        return undefined;
      });
    },
  };
}
