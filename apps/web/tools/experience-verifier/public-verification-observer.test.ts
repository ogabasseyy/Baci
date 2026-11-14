import { expect, it, vi } from 'vitest';
import { createPublicObservationAdapter } from './public-verification-observer';

const digest = 'a'.repeat(64);
const binding = {
  canonicalBase: 'https://shop.example',
  buildDigest: digest,
  merchantId: '10000000-0000-4000-8000-000000000001',
};
const expected = {
  buildDigest: digest,
  routes: [{ path: '/', canonical: 'https://shop.example/', title: 'Shop' }],
  product: { id: 'p', path: '/products/p' },
};
const output = [
  {
    url: 'https://runtime.example/published/shop/app.js',
    mime: 'text/javascript',
    bytes: Buffer.from('app'),
    securityHeaders: {},
  },
];
const pages = [
  {
    canonical: 'https://shop.example/',
    path: '/',
    title: 'Shop',
    bytes: Buffer.from('<html></html>'),
    securityHeaders: {},
  },
];
const framework = [
  {
    url: 'https://shop.example/_next/static/a.js',
    mime: 'text/javascript',
    bytes: Buffer.from('framework'),
    headers: {},
  },
];
const frames = [
  {
    url: 'https://runtime.example/published/shop/index.html?path=%2F',
    mime: 'text/html',
    bytes: Buffer.from('<html></html>'),
    headers: {},
  },
];

it('passes bounded verified bytes and the restricted relay into the isolated job', async () => {
  const session = vi.fn();
  const run = vi.fn(
    async (
      _input: Parameters<
        NonNullable<Parameters<typeof createPublicObservationAdapter>[1]>
      >[0]
    ) => ({
      output: { synthetic: true },
      wallMs: 1,
      jobId: 'job',
    })
  );
  const observe = createPublicObservationAdapter(
    'https://project.supabase.co',
    run
  );
  await expect(
    observe(
      binding as never,
      output as never,
      pages as never,
      expected as never,
      session as never,
      framework,
      frames
    )
  ).resolves.toEqual({ synthetic: true });
  expect(run).toHaveBeenCalledOnce();
  const input = run.mock.calls[0][0];
  expect(input.session).toBe(session);
  expect(input.payload.product.origin).toBe('https://project.supabase.co');
  expect(input.payload.resources).toHaveLength(4);
  expect(input.payload.resources[0]).toMatchObject({
    url: output[0].url,
    bytes: Buffer.from('app').toString('base64'),
  });
  expect(JSON.stringify(input.payload)).not.toContain('anonKey');
});

it('rejects duplicate resources, mismatched builds and excessive encoded payloads before starting the job', async () => {
  const run = vi.fn();
  const observe = createPublicObservationAdapter(
    'https://project.supabase.co',
    run
  );
  const session = vi.fn();
  await expect(
    observe(
      binding as never,
      output as never,
      pages as never,
      { ...expected, buildDigest: 'b'.repeat(64) } as never,
      session as never,
      framework,
      frames
    )
  ).rejects.toThrow();
  await expect(
    observe(
      binding as never,
      [...output, ...output] as never,
      pages as never,
      expected as never,
      session as never,
      framework,
      frames
    )
  ).rejects.toThrow();
  const large = Array.from({ length: 5 }, (_, i) => ({
    ...framework[0],
    url: `https://shop.example/_next/static/${i}.js`,
    bytes: Buffer.alloc(1500000),
  }));
  await expect(
    observe(
      binding as never,
      output as never,
      pages as never,
      expected as never,
      session as never,
      large,
      frames
    )
  ).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});
