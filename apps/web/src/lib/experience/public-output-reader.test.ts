// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { digestBytes } from './manifest-digest';
import { createPublicOutputReader } from './public-output-reader';

it('reads only verified public files and rejects malformed hex/private output', async () => {
  const bytes = Buffer.from('export{}');
  const build = 'a'.repeat(64);
  const head = {
    version: 1,
    merchantId: '11111111-1111-4111-8111-111111111111',
    buildDigest: build,
    policyRevision: 'p',
    assetsDigest: 'b'.repeat(64),
    routes: [{ path: '/', view: 'home' }],
    capabilities: [],
  };
  let corrupt = false;
  const rpc = vi.fn(async (name: string) => ({
    error: null,
    data:
      name === 'experience_public_manifest'
        ? head
        : {
            path: 'app.js',
            digest: digestBytes(bytes),
            mime: 'text/javascript',
            hex: corrupt ? 'secret' : bytes.toString('hex'),
          },
  }));
  const reader = createPublicOutputReader({ rpc } as never);
  expect((await reader.read('qa1', build, 'app.js'))?.bytes).toEqual(bytes);
  corrupt = true;
  expect(await reader.read('qa1', build, 'app.js')).toBeNull();
  rpc.mockClear();
  expect(await reader.read('qa1', build, 'source.tsx')).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});

it.each([
  'experience_public_file',
  'experience_public_prerender_binding',
])('cancels a stalled %s request when the delivery read is aborted', async (rpcName) => {
  const slug = 'qa1';
  const build = 'a'.repeat(64);
  const started = Promise.withResolvers<AbortSignal | undefined | null>();
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (String(input).endsWith('/experience_public_manifest')) {
      return Response.json({
        version: 1,
        merchantId: '11111111-1111-4111-8111-111111111111',
        buildDigest: build,
        policyRevision: 'p',
        assetsDigest: 'b'.repeat(64),
        routes: [{ path: '/', view: 'home' }],
        capabilities: [],
      });
    }
    expect(String(input).endsWith(`/${rpcName}`)).toBe(true);
    const signal = init?.signal;
    started.resolve(signal);
    if (!signal) return new Response(null, { status: 500 });
    await new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
    throw Error('UNREACHABLE');
  });
  const reader = createPublicOutputReader(
    createClient('https://database.test', 'synthetic-key', {
      global: { fetch },
    })
  );
  const abort = new AbortController();
  const pending =
    rpcName === 'experience_public_file'
      ? reader.read(slug, build, 'app.js', abort.signal)
      : reader.prerenderBinding(slug, build, abort.signal);
  const signal = await started.promise;
  expect(signal?.aborted).toBe(false);
  abort.abort();
  expect(await pending).toBeNull();
  expect(signal?.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});
