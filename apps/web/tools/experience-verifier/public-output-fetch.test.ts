import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { fetchPublicOutput } from './public-output-fetch';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const binding = {
  slug: 'synthetic',
  buildDigest: 'a'.repeat(64),
  canonicalBase: 'https://shop.example.com',
  scriptDigest: hash('script'),
  styleDigest: hash('style'),
  assets: { logo: hash('image') },
};
it('fetches and checks exactly the bound public assets through the guarded fetcher', async () => {
  const network = vi.fn(async (url: URL) => {
    const value = url.pathname.endsWith('app.js')
      ? ['script', 'text/javascript']
      : url.pathname.endsWith('app.css')
        ? ['style', 'text/css']
        : ['image', 'image/png'];
    return {
      response: new Response(value[0], {
        headers: {
          'content-type': value[1],
          'access-control-allow-origin': '*',
          'set-cookie': 'private=secret',
        },
      }),
      close: async () => {},
    };
  });
  const files = await fetchPublicOutput(
    binding,
    'https://runtime.other-example.com',
    { resolve: async () => [{ address: '8.8.8.8', family: 4 }], network }
  );
  expect(files.map((f) => f.mime)).toEqual([
    'text/javascript',
    'text/css',
    'image/png',
  ]);
  expect(network).toHaveBeenCalledTimes(3);
  for (const file of files)
    expect(file.securityHeaders).toEqual({
      'access-control-allow-origin': '*',
    });
});
