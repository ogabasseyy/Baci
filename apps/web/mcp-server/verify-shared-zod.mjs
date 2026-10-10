import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifySharedZod(webRoot, sharedRoot) {
  const webRequire = createRequire(resolve(webRoot, 'package.json'));
  const sharedRequire = createRequire(resolve(sharedRoot, 'package.json'));
  const webPath = webRequire.resolve('zod');
  const sharedPath = sharedRequire.resolve('zod');
  if (webPath !== sharedPath || typeof sharedRequire('zod').z.uuid !== 'function') {
    throw new Error('MCP shared workspace must resolve the web Zod 4 peer dependency');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifySharedZod('/app/apps/web', '/app/packages/shared');
  console.log('MCP shared Zod 4 runtime verified.');
}
