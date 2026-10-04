import { jest } from '@jest/globals';
import { createLocalStorefrontFetch } from './create-local-storefront-fetch';

const options = {
  apiOrigin: 'http://192.168.100.70:4193',
  supabaseOrigin: 'http://192.168.100.70:4192',
  token: 'a'.repeat(48),
  anonKey: 'local-anon',
  expectedAuthIssuer: 'http://127.0.0.1:55431/auth/v1',
};

it.each([
  options.apiOrigin,
  options.supabaseOrigin,
])('injects the exact capability into Request and init headers at %s', async (origin) => {
  const transport = jest
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('{}'));
  const guarded = createLocalStorefrontFetch(transport, options);
  const request = new Request(`${origin}/auth/v1/otp`, {
    method: 'POST',
    body: '{"email":"customer@savings.local.test"}',
    headers: { apikey: options.anonKey },
  });
  await guarded(request, {
    headers: {
      authorization: `Bearer ${options.anonKey}`,
      'content-type': 'application/json',
    },
  });
  const [sent, init] = transport.mock.calls[0];
  expect(await (sent as Request).text()).toContain(
    'customer@savings.local.test'
  );
  const headers = new Headers(init?.headers);
  expect(headers.get('x-baci-local-test')).toBe(options.token);
  expect(headers.get('authorization')).toBe(`Bearer ${options.anonKey}`);
  expect(init).toEqual(
    expect.objectContaining({ redirect: 'error', credentials: 'omit' })
  );
});

it.each([
  'https://production.supabase.co/auth/v1/token',
  'https://ogabassey.com/api',
  'http://192.168.100.70:4194/',
  'http://192.168.100.70.evil.test:4193/',
  'http://127.0.0.1:4193/',
])('never sends capability or requests to %s', async (url) => {
  const transport = jest.fn<typeof fetch>();
  await expect(
    createLocalStorefrontFetch(transport, options)(url)
  ).rejects.toThrow('non-local request');
  expect(transport).not.toHaveBeenCalled();
});

const forbiddenHeaders: Record<string, string>[] = [
  { authorization: 'Bearer hosted-token' },
  { apikey: 'service-role' },
  { cookie: 'production-session' },
];
it.each(
  forbiddenHeaders
)('rejects inherited credentials %j before transport', async (headers) => {
  const transport = jest.fn<typeof fetch>();
  await expect(
    createLocalStorefrontFetch(transport, options)(options.apiOrigin, {
      headers,
    })
  ).rejects.toThrow('blocked');
  expect(transport).not.toHaveBeenCalled();
});

it('accepts only the exact Auth issuer and blocks foreign local and hosted JWTs before transport', async () => {
  const transport = jest
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('{}'));
  const guarded = createLocalStorefrontFetch(transport, options);
  for (const issuer of [
    'http://127.0.0.1:55431/auth/v1',
    `${options.supabaseOrigin}/auth/v1`,
    'http://127.0.0.1:54321/auth/v1',
    'http://192.168.100.71:55431/auth/v1',
    'https://hosted.supabase.co/auth/v1',
  ]) {
    const token = `header.${btoa(JSON.stringify({ role: 'authenticated', iss: issuer }))}.signature`;
    const result = guarded(options.apiOrigin, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (issuer !== options.expectedAuthIssuer)
      await expect(result).rejects.toThrow('non-local authorization');
    else await expect(result).resolves.toBeDefined();
  }
  expect(transport).toHaveBeenCalledTimes(1);
});

it('requires a capability and rejects a transport that followed a redirect', async () => {
  expect(() =>
    createLocalStorefrontFetch(fetch, { ...options, token: '' })
  ).toThrow('Invalid local');
  const response = new Response('{}');
  Object.defineProperty(response, 'url', {
    value: 'https://production.invalid',
  });
  await expect(
    createLocalStorefrontFetch(
      jest.fn<typeof fetch>().mockResolvedValue(response),
      options
    )(options.apiOrigin)
  ).rejects.toThrow('redirected');
});
