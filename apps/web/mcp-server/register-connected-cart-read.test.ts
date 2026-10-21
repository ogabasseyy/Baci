import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { expect, it, vi } from 'vitest';
import { registerConnectedCartRead } from './register-connected-cart-read';
it('refreshes the verified connection cart without exposing its capability', async () => {
  const token = 'd'.repeat(64);
  const read = vi
    .fn()
    .mockResolvedValue({
      cart_token: token,
      items: [{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 2 }],
      expires_at: '2099-01-01T00:00:00.000Z',
      cart_url:
        'https://ogabassey.com/cart#handoff=ch1.fixture.signature&hid=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      canonical_cart_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      version: 3,
    });
  const server = new McpServer({ name: 'cart-reader', version: '1.0.0' });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  registerConnectedCartRead(
    server,
    { update: vi.fn(), hasToken: async () => true, readConnectionCart: read },
    { resolveToken: async () => token },
  );
  await server.connect(st);
  await client.connect(ct);
  try {
    const result = await client.callTool({ name: 'get_ogabassey_guest_cart', arguments: {} });
    expect(read).toHaveBeenCalledWith(token);
    expect(result.structuredContent).toMatchObject({
      success: true,
      connection_bound: true,
      version: 3,
    });
    expect(JSON.stringify(result)).not.toContain(token);
    read.mockRejectedValueOnce(new Error(`private ${token}`));
    const failed = await client.callTool({ name: 'get_ogabassey_guest_cart', arguments: {} });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain(token);
  } finally {
    await client.close();
    await server.close();
  }
});
