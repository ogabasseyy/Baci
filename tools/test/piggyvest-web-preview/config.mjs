import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createPreviewConfig(tailwindPlugin) {
  const root = dirname(fileURLToPath(import.meta.url));
  const workspace = resolve(root, '../../..');
  return {
    root,
    configFile: false,
    envFile: false,
    envPrefix: [],
    publicDir: false,
    cacheDir: resolve(root, '.vite'),
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: { '@': resolve(workspace, 'apps/web/src') },
      dedupe: ['react', 'react-dom'],
    },
    css: { postcss: { plugins: [tailwindPlugin] } },
    server: {
      host: '127.0.0.1',
      port: 4179,
      strictPort: true,
      open: false,
      cors: false,
      allowedHosts: ['127.0.0.1'],
      fs: {
        strict: true,
        allow: [
          root,
          resolve(workspace, 'apps/web/src'),
          resolve(workspace, 'node_modules'),
          resolve(workspace, 'apps/web/node_modules'),
        ],
        deny: ['**/.env*', '**/.git/**', '**/*.{pem,key,crt}'],
      },
      headers: {
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:4179; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-src 'none'; form-action 'none'",
        'Cache-Control': 'no-store',
      },
    },
  };
}
