import { expect, it, vi } from 'vitest';
import { createBoundPublicFetcher } from './public-fetch';

it('refuses unbound origins, credentials, redirects, and private DNS before making requests', async () => {
  const network = vi.fn();
  const fetch = createBoundPublicFetcher({
    origins: ['https://merchant.example.com'],
    urls: ['https://merchant.example.com/'],
    resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    network,
  });
  for (const url of [
    'https://evil.example.com/',
    'https://merchant.example.com/other',
    'https://user@merchant.example.com/',
    'http://merchant.example.com/',
    'https://merchant.example.com/#secret',
    'https://merchant.example.com/',
  ]) {
    await expect(fetch(url)).rejects.toThrow();
  }
  expect(network).not.toHaveBeenCalled();
});

it('pins a public DNS answer and rejects redirects or excessive data', async () => {
  const network = vi.fn(async () => ({
    response: new Response('moved', {
      status: 302,
      headers: { location: 'https://evil.example.com/' },
    }),
    close: async () => {},
  }));
  const fetch = createBoundPublicFetcher({
    origins: ['https://merchant.example.com'],
    urls: ['https://merchant.example.com/'],
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    network,
  });
  await expect(fetch('https://merchant.example.com/')).rejects.toThrow(
    'PUBLIC_FETCH_FAILED'
  );
  expect(network).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({ address: '8.8.8.8', family: 4 })
  );
});

it('accepts an exact bound public resource without cookies or caller-provided headers', async () => {
  const network = vi.fn(async () => ({
    response: new Response('synthetic', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
    close: async () => {},
  }));
  const fetch = createBoundPublicFetcher({
    origins: ['https://merchant.example.com'],
    urls: ['https://merchant.example.com/'],
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    network,
  });
  const result = await fetch('https://merchant.example.com/');
  expect(result.body.toString()).toBe('synthetic');
  expect(result.contentType).toBe('text/html');
});

it('retains only bounded public browser-security headers and never forwards response cookies', async () => {
  const fetch = createBoundPublicFetcher({
    origins: ['https://merchant.example.com'],
    urls: ['https://merchant.example.com/'],
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    network: async () => ({
      response: new Response('synthetic', {
        headers: {
          'content-security-policy': "default-src 'self'",
          'x-frame-options': 'DENY',
          'set-cookie': 'private_session=secret',
          'x-private-debug': 'do-not-forward',
        },
      }),
      close: async () => {},
    }),
  });
  expect(
    (await fetch('https://merchant.example.com/')).securityHeaders
  ).toEqual({
    'content-security-policy': "default-src 'self'",
    'x-frame-options': 'DENY',
  });
});

it('rejects oversized browser-security headers rather than forwarding unbounded data', async () => {
  const fetch = createBoundPublicFetcher({
    origins: ['https://merchant.example.com'],
    urls: ['https://merchant.example.com/'],
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    network: async () => ({
      response: new Response('synthetic', {
        headers: { 'content-security-policy': 'x'.repeat(8193) },
      }),
      close: async () => {},
    }),
  });
  await expect(fetch('https://merchant.example.com/')).rejects.toThrow(
    'PUBLIC_FETCH_FAILED'
  );
});

it('rejects oversized content types and aggregate browser-security headers', async () => {
  for (const headers of [
    { 'content-type': 'x'.repeat(1025) },
    {
      'content-security-policy': 'x'.repeat(8192),
      'x-frame-options': 'x'.repeat(8192),
      'referrer-policy': 'x'.repeat(8192),
      'permissions-policy': 'x'.repeat(8192),
      'cross-origin-opener-policy': 'x',
    },
  ]) {
    const fetch = createBoundPublicFetcher({
      origins: ['https://merchant.example.com'],
      urls: ['https://merchant.example.com/'],
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      network: async () => ({
        response: new Response('synthetic', { headers }),
        close: async () => {},
      }),
    });
    await expect(fetch('https://merchant.example.com/')).rejects.toThrow(
      'PUBLIC_FETCH_FAILED'
    );
  }
});

it('rejects mixed public/private DNS and oversized responses', async () => {
  const network = vi.fn(async () => ({
    response: new Response(new Uint8Array(2097153)),
    close: async () => {},
  }));
  const mixed = createBoundPublicFetcher({
    origins: ['https://merchant.example.com'],
    urls: ['https://merchant.example.com/'],
    resolve: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ],
    network,
  });
  await expect(mixed('https://merchant.example.com/')).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
  const oversized = createBoundPublicFetcher({
    origins: ['https://merchant.example.com'],
    urls: ['https://merchant.example.com/'],
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    network,
  });
  await expect(oversized('https://merchant.example.com/')).rejects.toThrow();
});

it('rejects partial-content responses instead of treating them as complete pages', async () => {
  const fetch = createBoundPublicFetcher({
    origins: ['https://merchant.example.com'],
    urls: ['https://merchant.example.com/'],
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    network: async () => ({
      response: new Response('partial', { status: 206 }),
      close: async () => {},
    }),
  });
  await expect(fetch('https://merchant.example.com/')).rejects.toThrow(
    'PUBLIC_FETCH_FAILED'
  );
});

it('cancels an unconsumed rejected response before closing the connection', async () => {
  const events: string[] = [];
  const stream = new ReadableStream({
    cancel() {
      events.push('cancel');
    },
  });
  const fetch = createBoundPublicFetcher({
    origins: ['https://merchant.example.com'],
    urls: ['https://merchant.example.com/'],
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    network: async () => ({
      response: new Response(stream, { status: 302 }),
      close: async () => {
        events.push('close');
      },
    }),
  });
  await expect(fetch('https://merchant.example.com/')).rejects.toThrow();
  expect(events).toEqual(['cancel', 'close']);
});

it('can inspect a full 64-route storefront and its resources without removing the request limit', async () => {
  const urls = Array.from(
    { length: 162 },
    (_, i) => `https://merchant.example.com/resource-${i}`
  );
  const network = vi.fn(async () => ({
    response: new Response('x'),
    close: async () => {},
  }));
  const fetch = createBoundPublicFetcher({
    origins: ['https://merchant.example.com'],
    urls,
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    network,
  });
  for (const url of urls) await fetch(url);
  expect(network).toHaveBeenCalledTimes(162);
  for (let i = 162; i < 256; i++) await fetch(urls[0]);
  await expect(fetch(urls[0])).rejects.toThrow('PUBLIC_FETCH_FAILED');
  expect(network).toHaveBeenCalledTimes(256);
});
