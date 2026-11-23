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

it('rejects duplicate resources, mismatched builds and excessive resource bytes before starting the job', async () => {
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
  const largeBytes = Buffer.alloc(2 * 1024 * 1024);
  const large = Array.from({ length: 33 }, (_, i) => ({
    ...framework[0],
    url: `https://shop.example/_next/static/${i}.js`,
    bytes: largeBytes,
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

it('admits all 32 performance-sized PNG assets alongside pages and framework files', async () => {
  const run = vi.fn(async () => ({ output: { synthetic: true } }));
  const observe = createPublicObservationAdapter(
    'https://project.supabase.co',
    run
  );
  const png = Buffer.alloc(256 * 1024);
  const assets = Array.from({ length: 32 }, (_, index) => ({
    url: `https://runtime.example/published/shop/assets/${index}.png`,
    mime: 'image/png',
    bytes: png,
    securityHeaders: {},
  }));
  await expect(
    observe(
      binding as never,
      [...output, ...assets] as never,
      pages as never,
      expected as never,
      vi.fn() as never,
      framework,
      frames
    )
  ).resolves.toEqual({ synthetic: true });
  expect(run).toHaveBeenCalledOnce();
});

it('admits 64 pages and frames with 34 delivery files and 95 framework assets', async () => {
  const run = vi.fn(async (_input: { routeCount: number }) => ({
    output: { synthetic: true },
  }));
  const observe = createPublicObservationAdapter(
    'https://project.supabase.co',
    run
  );
  await expect(
    observe(
      binding as never,
      Array.from({ length: 34 }, (_, index) => ({
        ...output[0],
        url: `https://runtime.example/published/shop/file-${index}`,
      })) as never,
      Array.from({ length: 64 }, (_, index) => ({
        ...pages[0],
        canonical: `https://shop.example/page-${index}`,
      })) as never,
      {
        ...expected,
        routes: Array.from({ length: 64 }, (_, index) => ({
          ...expected.routes[0],
          path: `/page-${index}`,
          canonical: `https://shop.example/page-${index}`,
        })),
      } as never,
      vi.fn() as never,
      Array.from({ length: 95 }, (_, index) => ({
        ...framework[0],
        url: `https://shop.example/_next/static/chunk-${index}.js`,
      })),
      Array.from({ length: 64 }, (_, index) => ({
        ...frames[0],
        url: `https://runtime.example/published/shop/index.html?path=%2Fpage-${index}`,
      }))
    )
  ).resolves.toEqual({ synthetic: true });
  expect(run.mock.calls[0][0].routeCount).toBe(64);
});
