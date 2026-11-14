import { expect, it, vi } from 'vitest';
import { createQualifiedPublicObserver } from './public-verification-qualified';

const digest = 'a'.repeat(64);

it('requires a matching installation receipt before producing an observer', async () => {
  const execute = vi.fn();
  await expect(
    createQualifiedPublicObserver({
      productOrigin: 'https://project.supabase.co',
      toolchainDigest: digest,
      verifyInstallation: async () => ({ toolchainDigest: 'b'.repeat(64) }),
      execute,
    })
  ).rejects.toThrow('TOOLCHAIN_MISMATCH');
  expect(execute).not.toHaveBeenCalled();
});

it('allows only one job at a time and releases its lane on failure', async () => {
  let release: (() => void) | undefined;
  const execute = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    throw Error('worker failed');
  });
  const observer = await createQualifiedPublicObserver({
    productOrigin: 'https://project.supabase.co',
    toolchainDigest: digest,
    verifyInstallation: async () => ({ toolchainDigest: digest }),
    execute,
  });
  const binding = {
    canonicalBase: 'https://shop.example.com',
    buildDigest: digest,
    merchantId: '11111111-1111-4111-8111-111111111111',
  };
  const expected = {
    buildDigest: digest,
    product: { id: '33333333-3333-4333-8333-333333333333' },
  };
  const output = [
    {
      url: 'https://runtime.example.net/a.js',
      mime: 'text/javascript',
      bytes: Buffer.from('a'),
      securityHeaders: {},
    },
  ];
  const pages = [
    {
      canonical: 'https://shop.example.com/',
      bytes: Buffer.from('p'),
      securityHeaders: {},
    },
  ];
  const frames = [
    {
      url: 'https://runtime.example.net/frame',
      mime: 'text/html',
      bytes: Buffer.from('f'),
      headers: {},
    },
  ];
  const invoke = () =>
    observer(
      binding as never,
      output as never,
      pages as never,
      expected as never,
      vi.fn() as never,
      [],
      frames
    );
  const first = invoke();
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  await expect(invoke()).rejects.toThrow('PUBLIC_OBSERVER_BUSY');
  release?.();
  await expect(first).rejects.toThrow('worker failed');
  const next = invoke();
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  release?.();
  await expect(next).rejects.toThrow('worker failed');
});

it.each([
  'PUBLIC_OBSERVATION_CLEANUP_FAILED',
  'PUBLIC_OBSERVATION_PREPARE_UNCERTAIN',
])('disables the lane after %s instead of starting another job', async (failure) => {
  const execute = vi.fn(async () => {
    throw Error(failure);
  });
  const observer = await createQualifiedPublicObserver({
    productOrigin: 'https://project.supabase.co',
    toolchainDigest: digest,
    verifyInstallation: async () => ({ toolchainDigest: digest }),
    execute,
  });
  const invoke = () =>
    observer(
      {
        canonicalBase: 'https://shop.example.com',
        buildDigest: digest,
        merchantId: '11111111-1111-4111-8111-111111111111',
      } as never,
      [
        {
          url: 'https://runtime.example.net/a.js',
          mime: 'text/javascript',
          bytes: Buffer.from('a'),
          securityHeaders: {},
        },
      ] as never,
      [
        {
          canonical: 'https://shop.example.com/',
          bytes: Buffer.from('p'),
          securityHeaders: {},
        },
      ] as never,
      {
        buildDigest: digest,
        product: { id: '33333333-3333-4333-8333-333333333333' },
      } as never,
      vi.fn() as never,
      [],
      [
        {
          url: 'https://runtime.example.net/frame',
          mime: 'text/html',
          bytes: Buffer.from('f'),
          headers: {},
        },
      ]
    );
  await expect(invoke()).rejects.toThrow(failure);
  await expect(invoke()).rejects.toThrow('PUBLIC_OBSERVER_UNAVAILABLE');
  expect(execute).toHaveBeenCalledOnce();
});
