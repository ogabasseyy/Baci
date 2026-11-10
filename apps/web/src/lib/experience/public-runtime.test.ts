// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createPublicExperienceRuntime } from './public-runtime';

it('declines cross-merchant public heads and refuses caller credentials in execution origins', async () => {
  const rpc = vi.fn(async () => ({
    error: null,
    data: {
      merchantId: '22222222-2222-4222-8222-222222222222',
      buildDigest: 'a'.repeat(64),
      version: 1,
      policyRevision: 'p',
      assetsDigest: 'b'.repeat(64),
      routes: [],
      capabilities: [],
    },
  }));
  const options = {
    client: { rpc } as never,
    runtimeBase: 'http://127.0.0.1:43175',
    canonicalBase: (slug: string) => `http://localhost/${slug}`,
  };
  const r = createPublicExperienceRuntime(options);
  expect(
    await r.loadPublishedManifest({
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'qa1',
    })
  ).toBeNull();
  expect(() =>
    createPublicExperienceRuntime({
      ...options,
      runtimeBase: 'https://user:secret@execution.test/',
    })
  ).toThrow('INVALID_RUNTIME_ORIGIN');
});

it('starts independent public merchant and head reads without a head-to-merchant waterfall', async () => {
  let release: (value: { data: null; error: null }) => void = () => {};
  const head = new Promise<{ data: null; error: null }>((r) => {
    release = r;
  });
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    }),
  }));
  const runtime = createPublicExperienceRuntime({
    client: { rpc: () => head, from } as never,
    runtimeBase: 'http://127.0.0.1:43179',
    canonicalBase: () => 'http://localhost/qa1',
  });
  const result = runtime.resolveBoundary(
    { id: '11111111-1111-4111-8111-111111111111', slug: 'qa1' },
    '/'
  );
  try {
    await vi.waitFor(() => expect(from).toHaveBeenCalledWith('merchants'), {
      timeout: 1000,
    });
  } finally {
    release({ data: null, error: null });
    await result;
  }
  expect(await result).toBeNull();
});
