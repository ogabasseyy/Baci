import { expect, it, vi } from 'vitest';
import { createPublicFrameworkReader } from './public-framework-reader';

it('returns bounded, typed assets only for allowed same-origin requests', async () => {
  const fetchAsset = vi.fn(async () => ({
    body: Buffer.from('synthetic'),
    contentType: 'text/javascript',
  }));
  const read = createPublicFrameworkReader(
    'https://shop.example.com',
    fetchAsset
  );
  const request = {
    url: 'https://shop.example.com/_next/static/chunks/a.js',
    method: 'GET',
  };
  expect(JSON.parse((await read(request)).body)).toEqual({
    mime: 'text/javascript',
    bytes: Buffer.from('synthetic').toString('base64'),
  });
  await expect(
    read({ ...request, url: 'https://other.example/_next/static/a.js' })
  ).rejects.toThrow();
  expect(fetchAsset).toHaveBeenCalledOnce();
});

it('enforces the per-observation request budget', async () => {
  const fetchAsset = vi.fn(async () => ({
    body: Buffer.from('x'),
    contentType: 'text/javascript',
  }));
  const read = createPublicFrameworkReader(
    'https://shop.example.com',
    fetchAsset
  );
  const request = {
    url: 'https://shop.example.com/_next/static/a.js',
    method: 'GET',
  };
  for (let i = 0; i < 32; i++) await read(request);
  await expect(read(request)).rejects.toThrow('PUBLIC_FRAMEWORK_DENIED');
  expect(fetchAsset).toHaveBeenCalledTimes(32);
});

it('rejects content type mismatches and oversized responses', async () => {
  const request = {
    url: 'https://shop.example.com/_next/static/chunks/a.js',
    method: 'GET',
  };
  const badType = createPublicFrameworkReader(
    'https://shop.example.com',
    async () => ({ body: Buffer.from('x'), contentType: 'text/html' })
  );
  await expect(badType(request)).rejects.toThrow();
  const tooLarge = createPublicFrameworkReader(
    'https://shop.example.com',
    async () => ({ body: Buffer.alloc(700001), contentType: 'text/javascript' })
  );
  await expect(tooLarge(request)).rejects.toThrow();
});
