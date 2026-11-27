import { build } from 'esbuild';
import {
  COMPILER_ROOT,
  createClosedStorefrontGraphPlugin,
  StorefrontCompilerError,
} from './closed-graph-plugin';

export const PREBUNDLE_VIRTUAL_ENTRY = '__baci_prebundled_app__.js';

const SINGLETON_RUNTIME_PACKAGES: ReadonlySet<string> = new Set([
  'react',
  'react-dom',
  '@baci/experience-sdk',
]);

export async function prebundleMerchantEntrySource(options: {
  entry: string;
  virtualFiles: ReadonlyMap<string, string>;
  declaredPackages: ReadonlySet<string>;
  declaredAssetIds: ReadonlySet<string>;
  targetRuntime: 'client' | 'worker';
}): Promise<string> {
  const {
    entry,
    virtualFiles,
    declaredPackages,
    declaredAssetIds,
    targetRuntime,
  } = options;
  try {
    const result = await build({
      entryPoints: [entry],
      absWorkingDir: COMPILER_ROOT,
      bundle: true,
      platform: targetRuntime === 'client' ? 'browser' : 'neutral',
      ...(targetRuntime === 'worker'
        ? {
            conditions: ['workerd', 'worker', 'browser', 'import'],
            mainFields: ['browser', 'module', 'main'],
          }
        : {}),
      format: 'esm',
      jsx: 'automatic',
      treeShaking: true,
      write: false,
      minify: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [
        createClosedStorefrontGraphPlugin({
          virtualFiles,
          declaredPackages,
          declaredAssetIds,
          externalSingletons: SINGLETON_RUNTIME_PACKAGES,
        }),
      ],
    });
    return result.outputFiles?.[0]?.text ?? '';
  } catch (error) {
    if (error instanceof StorefrontCompilerError) throw error;
    throw new StorefrontCompilerError(
      'GRAPH_ESCAPE_BLOCKED',
      error instanceof Error ? error.message : 'Merchant prebundle failed'
    );
  }
}
