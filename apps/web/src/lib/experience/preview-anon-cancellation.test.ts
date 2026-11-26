// @vitest-environment node
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { resolveCanonicalBase } from './canonical-domain';
import { readPreviewBindingLiveness } from './preview-binding-liveness';

it.each([
  'canonical',
  'preview liveness',
  'delivery deadline',
] as const)('closes a hung anonymous HTTP lookup during %s', async (kind) => {
  const accepted = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const controller = new AbortController();
  const server = createServer((req, res) => {
    if (
      kind !== 'canonical' &&
      req.url === '/rest/v1/rpc/resolve_storefront_custom_domain'
    ) {
      res.end('null');
      return;
    }
    res.once('close', closed.resolve);
    accepted.resolve();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const client = createClient(
    `http://127.0.0.1:${address.port}`,
    'sb_publishable_synthetic',
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  try {
    const operation =
      kind === 'canonical'
        ? resolveCanonicalBase(client, 'shop', 'usebaci.com', controller.signal)
        : readPreviewBindingLiveness(
            client,
            '10000000-0000-4000-8000-000000000001',
            kind === 'preview liveness' ? controller.signal : undefined
          );
    const expected = expect(operation).rejects.toHaveProperty(
      'name',
      kind === 'delivery deadline' ? 'TimeoutError' : 'AbortError'
    );
    await accepted.promise;
    if (kind !== 'delivery deadline') controller.abort();
    await expected;
    await closed.promise;
    if (kind === 'preview liveness') {
      await expect(
        resolveCanonicalBase(client, 'shop', 'usebaci.com')
      ).resolves.toBe('https://shop.usebaci.com');
    }
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 8000);
