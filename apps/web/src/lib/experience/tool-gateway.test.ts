import { expect, it, vi } from 'vitest';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import { createExperienceGateway } from './tool-gateway';

const id = '11111111-1111-4111-8111-111111111111';
function fixture(scopes = ['storefront.read']) {
  const identity = {
    actorUserId: id,
    connectionId: id,
    grantVersion: 1,
    allowedMerchantIds: [id],
    scopes: new Set(scopes),
    allowCreateStore: false,
  } as BuilderIdentity;
  const authenticate = vi.fn(async () => identity);
  const execute = vi.fn(
    async (): Promise<unknown> => ({ status: 'ok', value: { synthetic: true } })
  );
  return {
    authenticate,
    execute,
    gateway: createExperienceGateway({ authenticate, execute }),
  };
}
function request(
  body = JSON.stringify({ storefrontId: id }),
  authorization: string | null = 'Bearer synthetic.token'
) {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
    body,
  });
}
it('admits authenticated, scoped, validated calls and returns non-cacheable output', async () => {
  const f = fixture();
  const response = await f.gateway(request(), 'get_experience_capabilities');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(f.execute).toHaveBeenCalledWith(
    expect.objectContaining({ actorUserId: id }),
    'get_experience_capabilities',
    { storefrontId: id }
  );
});
it.each([
  null,
  'Basic secret',
  'Bearer invalid token',
])('rejects invalid authentication syntax before executing: %s', async (token) => {
  const f = fixture();
  const r = await f.gateway(
    request(undefined, token),
    'get_experience_capabilities'
  );
  expect(r.status).toBe(401);
  expect(r.headers.get('www-authenticate')).toContain('invalid_token');
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});
it('does not expose authentication failures', async () => {
  const f = fixture();
  f.authenticate.mockRejectedValue(Error('private credential detail'));
  const r = await f.gateway(request(), 'get_experience_capabilities');
  expect(r.status).toBe(401);
  expect(await r.text()).not.toContain('private');
  expect(f.execute).not.toHaveBeenCalled();
});
it('rejects insufficient scopes before body admission or execution', async () => {
  const f = fixture([]);
  const r = await f.gateway(request(), 'get_experience_capabilities');
  expect(r.status).toBe(403);
  expect(r.headers.get('www-authenticate')).toContain('insufficient_scope');
  expect(f.execute).not.toHaveBeenCalled();
});
it.each([
  ['{', 400],
  [JSON.stringify({ storefrontId: 'invalid' }), 400],
  [' '.repeat(65537), 413],
])('rejects malformed, invalid and oversized input', async (body, status) => {
  const f = fixture();
  expect(
    (await f.gateway(request(body), 'get_experience_capabilities')).status
  ).toBe(status);
  expect(f.execute).not.toHaveBeenCalled();
});
it('rejects unknown tools and unsupported HTTP requests', async () => {
  const f = fixture();
  expect((await f.gateway(request(), 'unknown')).status).toBe(404);
  expect(
    (
      await f.gateway(
        new Request('http://localhost/api'),
        'get_experience_capabilities'
      )
    ).status
  ).toBe(400);
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});
it('throttles by stable connection identity rather than the bearer string', async () => {
  const f = fixture();
  for (let i = 0; i < 30; i++)
    expect(
      (
        await f.gateway(
          request(undefined, `Bearer token.${i}`),
          'get_experience_capabilities'
        )
      ).status
    ).toBe(200);
  expect(
    (await f.gateway(request(), 'get_experience_capabilities')).status
  ).toBe(429);
  expect(f.execute).toHaveBeenCalledTimes(30);
});
it.each([
  {},
  { status: 'ok', value: { secret: 'x'.repeat(98304) } },
])('rejects invalid or oversized execution results', async (result) => {
  const f = fixture();
  f.execute.mockResolvedValue(result);
  const r = await f.gateway(request(), 'get_experience_capabilities');
  expect(r.status).toBe(502);
  expect(await r.json()).toMatchObject({ code: 'UNAVAILABLE' });
});
it('returns a safe execution error', async () => {
  const f = fixture();
  f.execute.mockRejectedValue(Error('private detail'));
  const r = await f.gateway(request(), 'get_experience_capabilities');
  expect(r.status).toBe(500);
  expect(await r.text()).not.toContain('private');
});
