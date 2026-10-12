import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export async function compilePublicLauncher() {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const bundle = await build({
    entryPoints: [path.join(directory, 'launch-public.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['pg-native'],
    tsconfig: path.join(directory, '../../../apps/web/tsconfig.json'),
    plugins: [
      {
        name: 'server-only',
        setup(plugin) {
          plugin.onResolve({ filter: /^server-only$/ }, () => ({
            path: 'server-only',
            namespace: 'empty-server-only',
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: 'empty-server-only' },
            () => ({ contents: '' })
          );
        },
      },
    ],
  });
  return bundle.outputFiles[0].text;
}
