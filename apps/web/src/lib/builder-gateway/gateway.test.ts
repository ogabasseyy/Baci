import { describe, expect, it, vi } from 'vitest';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import { createBuilderGateway } from './gateway';

const id = '10000000-0000-4000-8000-000000000001';
const identity: BuilderIdentity = {
  actorUserId: id,
  connectionId: id,
  grantVersion: 1,
  scopes: new Set(['storefront.read', 'storefront.write']),
  allowedMerchantIds: [id],
  allowCreateStore: true,
};
function fixture() {
  const authenticate = vi.fn().mockResolvedValue(identity);
  const execute = vi.fn().mockResolvedValue({ stores: [], nextCursor: null });
  const audit = vi.fn();
  const handler = createBuilderGateway({ authenticate, execute, audit });
  return { handler, authenticate, execute, audit };
}
function request(body: unknown = {}, token = 'outer.fixture') {
  return new Request(
    'https://usebaci.com/api/integrations/chatgpt/builder/list_storefronts',
    {
      method: 'POST',
      headers: {
        ...(token
          ? { authorization: `Bearer ${token}` }
          : { cookie: 'session=not-authority' }),
        'content-type': 'application/json',
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }
  );
}
describe('fixed builder gateway', () => {
  it('rejects cookie-only/invalid bearer before any business operation', async () => {
    const f = fixture();
    expect((await f.handler(request({}, ''), 'list_storefronts')).status).toBe(
      401
    );
    expect(f.authenticate).not.toHaveBeenCalled();
    f.authenticate.mockRejectedValue(new Error('secret'));
    const r = await f.handler(request(), 'list_storefronts');
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('invalid_token');
    expect(await r.text()).not.toContain('secret');
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('intersects authenticated scope before write work and rejects unsupported tools', async () => {
    const f = fixture();
    f.authenticate.mockResolvedValue({
      ...identity,
      scopes: new Set(['storefront.read']),
    });
    const r = await f.handler(request(), 'create_storefront_draft');
    expect(r.status).toBe(403);
    expect(r.headers.get('www-authenticate')).toContain('storefront.write');
    expect((await f.handler(request(), 'delete_storefront')).status).toBe(404);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('enforces strict/bounded JSON and safe output; audit drops payloads and tokens', async () => {
    const f = fixture();
    expect((await f.handler(request('{'), 'list_storefronts')).status).toBe(
      400
    );
    expect(
      (await f.handler(request('x'.repeat(70000)), 'list_storefronts')).status
    ).toBe(413);
    expect(
      (
        await f.handler(
          request({ origin: 'https://evil.test' }),
          'list_storefronts'
        )
      ).status
    ).toBe(400);
    const r = await f.handler(request(), 'list_storefronts');
    expect(await r.json()).toEqual({ stores: [], nextCursor: null });
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain('outer.fixture');
    f.execute.mockResolvedValue({
      stores: [],
      nextCursor: null,
      upstreamToken: 'secret',
    });
    expect(
      await (await f.handler(request(), 'list_storefronts')).json()
    ).toMatchObject({ code: 'OPERATION_FAILED' });
  });
  it('throttles by stable user and connection, independent of bearer rotation', async () => {
    const f = fixture();
    const handler = createBuilderGateway({
      authenticate: f.authenticate,
      execute: f.execute,
      limits: { perUser: 2, perConnection: 1 },
    });
    expect((await handler(request({}, 'one'), 'list_storefronts')).status).toBe(
      200
    );
    expect((await handler(request({}, 'two'), 'list_storefronts')).status).toBe(
      429
    );
    f.authenticate.mockResolvedValue({
      ...identity,
      connectionId: '20000000-0000-4000-8000-000000000001',
    });
    expect(
      (await handler(request({}, 'three'), 'list_storefronts')).status
    ).toBe(429);
  });
});
