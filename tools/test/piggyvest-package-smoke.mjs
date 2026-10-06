import { createHash } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export async function buildPiggyvestSmokeArtifacts() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const result = await build({
    absWorkingDir: root,
    entryPoints: {
      http: 'apps/web/src/lib/piggyvest/runtime-composition-server.ts',
      funding: 'apps/web/src/lib/piggyvest/customer-funding-screen.ts',
      executor: 'apps/web/src/lib/piggyvest/postgres-executor.ts',
      nativeProbe: 'test-native-probe',
    },
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outdir: 'piggyvest-smoke-output',
    outExtension: { '.js': '.cjs' },
    write: false,
    metafile: true,
    logLevel: 'silent',
    define: { 'process.env': '{}' },
    tsconfigRaw: {
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@/*': ['apps/web/src/*'],
          '@baci/shared/contracts': ['packages/shared/src/contracts/index.ts'],
        },
      },
    },
    plugins: [
      {
        name: 'explicit-node-server-only',
        setup(builder) {
          builder.onResolve({ filter: /^pg-native$/ }, () => ({
            path: 'pg-native',
            namespace: 'native-rejected',
          }));
          builder.onLoad(
            { filter: /.*/, namespace: 'native-rejected' },
            () => ({
              contents:
                'throw new Error("TEST-only native PostgreSQL disabled");',
              loader: 'js',
            })
          );
          builder.onResolve({ filter: /^test-native-probe$/ }, () => ({
            path: 'test-native-probe',
            namespace: 'native-probe',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'native-probe' }, () => ({
            contents:
              'import pg from "pg"; export function requestNative() { return pg.native; }',
            loader: 'js',
            resolveDir: root,
          }));
          builder.onLoad(
            {
              filter:
                /(^|[/\\])(\.env[^/\\]*|env\.[cm]?[jt]s|[^/\\]*\.(pem|key|crt))$/,
            },
            () => ({
              errors: [
                { text: 'Secret or ambient environment input rejected' },
              ],
            })
          );
          builder.onResolve({ filter: /^server-only$/ }, () => ({
            path: 'server-only',
            namespace: 'server-marker',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'server-marker' }, () => ({
            contents: 'export {};',
            loader: 'js',
          }));
        },
      },
    ],
  });
  for (const output of Object.values(result.metafile.outputs)) {
    if (
      output.imports.some(
        (dependency) => dependency.external && !isBuiltin(dependency.path)
      )
    )
      throw new Error('Unpackaged runtime dependency');
  }
  const inputs = Object.keys(result.metafile.inputs);
  if (
    inputs.some((path) =>
      /(?:^|\/)\.env|(?:^|\/)env\.[cm]?[jt]s$|\.(pem|key|crt)$/.test(path)
    )
  )
    throw new Error('Ambient environment module rejected');
  return {
    inputs,
    testSubstitutions: [
      'process.env={} TEST-only',
      'server-only TEST marker',
      'pg-native TEST rejection',
    ],
    externalDependencies: [
      ...new Set(
        Object.values(result.metafile.outputs).flatMap((output) =>
          output.imports
            .filter((entry) => entry.external)
            .map((entry) => entry.path)
        )
      ),
    ],
    artifacts: result.outputFiles.map((file) => ({
      name: basename(file.path),
      bytes: file.contents,
      sha256: createHash('sha256').update(file.contents).digest('hex'),
    })),
  };
}
