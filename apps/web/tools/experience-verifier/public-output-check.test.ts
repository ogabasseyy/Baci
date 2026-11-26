import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { checkPublicOutput } from './public-output-check';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const build = 'a'.repeat(64);
const binding = {
  slug: 'synthetic',
  buildDigest: build,
  canonicalBase: 'https://shop.example.com',
  scriptDigest: hash('script'),
  styleDigest: hash('style'),
  assets: { logo: hash('image') },
};
it('checks the exact published script, style and assets against the bound head', async () => {
  const fetch = vi.fn(async (url: string) => ({
    body: Buffer.from(
      url.endsWith('app.js')
        ? 'script'
        : url.endsWith('app.css')
          ? 'style'
          : 'image'
    ),
    contentType: url.endsWith('app.js')
      ? 'text/javascript; charset=utf-8'
      : url.endsWith('app.css')
        ? 'text/css'
        : 'image/png',
  }));
  const files = await checkPublicOutput(
    binding,
    'https://runtime.other-example.com',
    fetch
  );
  expect(files).toHaveLength(3);
  expect(fetch).toHaveBeenCalledWith(
    `https://runtime.other-example.com/published/synthetic/${build}/app.css`
  );
});
it('rejects tampered bytes, wrong media types and execution origins on the storefront site', async () => {
  await expect(
    checkPublicOutput(
      binding,
      'https://runtime.other-example.com',
      async () => ({
        body: Buffer.from('tampered'),
        contentType: 'text/javascript',
      })
    )
  ).rejects.toThrow('PUBLIC_OUTPUT_MISMATCH');
  await expect(
    checkPublicOutput(
      binding,
      'https://runtime.other-example.com',
      async () => ({ body: Buffer.from('script'), contentType: 'text/html' })
    )
  ).rejects.toThrow('PUBLIC_OUTPUT_MISMATCH');
  await expect(
    checkPublicOutput(binding, 'https://runtime.example.com', vi.fn())
  ).rejects.toThrow();
});
