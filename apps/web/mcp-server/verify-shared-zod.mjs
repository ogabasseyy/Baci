import {
  lstatSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifySharedZod(webRoot, sharedRoot) {
  try {
    const webRequire = createRequire(resolve(webRoot, 'package.json'));
    const sharedRequire = createRequire(resolve(sharedRoot, 'package.json'));
    const webPath = webRequire.resolve('zod');
    const sharedPath = sharedRequire.resolve('zod');
    const uuidType = typeof sharedRequire('zod').z.uuid;
    if (
      realpathSync(webPath) !== realpathSync(sharedPath) ||
      uuidType !== 'function'
    ) {
      throw new Error(`web=${webPath}; shared=${sharedPath}; uuid=${uuidType}`);
    }
  } catch (cause) {
    throw new Error(
      'MCP shared workspace must resolve the web Zod 4 peer dependency',
      { cause }
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes('--link')) {
    linkSharedZod('/app/apps/web', '/app/packages/shared');
  }
  verifySharedZod('/app/apps/web', '/app/packages/shared');
  console.log('MCP shared Zod 4 runtime verified.');
}
export function linkSharedZod(webRoot, sharedRoot) {
  const webRequire = createRequire(resolve(webRoot, 'package.json'));
  const packageRoot = dirname(webRequire.resolve('zod/package.json'));
  mkdirSync(resolve(sharedRoot, 'node_modules'), { recursive: true });
  const peerPath = resolve(sharedRoot, 'node_modules/zod');
  const existing = lstatSync(peerPath, { throwIfNoEntry: false });
  if (existing) {
    try {
      if (realpathSync(peerPath) === realpathSync(packageRoot)) return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!existing.isSymbolicLink())
      throw new Error('Shared Zod peer already exists with a different target');
    unlinkSync(peerPath);
  }
  symlinkSync(packageRoot, peerPath);
}
