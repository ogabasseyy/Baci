import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name) => join(here, 'fixtures', name);

export const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    return await run(`http://127.0.0.1:${port}/asset.png`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

export const stubProbe = async () => ({ format: 'png', height: 1, width: 1 });

export function makeInputRoot() {
  return mkdtemp(join(tmpdir(), 'pilot-acquire-'));
}

