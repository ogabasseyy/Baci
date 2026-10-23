import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { afterEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createFakeGuestCartSupabase } from './guest-cart-fake-supabase';
import { GuestCartStore } from './guest-cart-store';
import { registerConfiguredGuestCartTool } from './guest-cart-registration';

vi.mock('./cart-handoff', () => ({
  prepareCartHandoff: vi
    .fn()
    .mockResolvedValue({ structuredContent: { success: true } }),
}));
const charger = '11111111-1111-4111-8111-111111111111';
const camera = '22222222-2222-4222-8222-222222222222';

afterEach(() => vi.unstubAllEnvs());
it.each([
  undefined,
  'false',
  'TRUE',
  '1',
  'true',
])('serializes the actual server registration policy for flag %s', async (flag) => {
  vi.stubEnv('BACI_MCP_PRIVATE_TEXT_CONTINUATION', flag);
  const enabled = flag === 'true';
  const server = new McpServer({ name: 'cart-test-server', version: '1.0.0' });
  const client = new Client({ name: 'cart-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  registerConfiguredGuestCartTool(server, {
    store: new GuestCartStore(createFakeGuestCartSupabase().supabase),
    supabase: {} as SupabaseClient,
    getMerchantId: async () => 'merchant',
    formatPrice: String,
    clientIp: `transport-policy-${flag}`,
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const first = await client.callTool({
      name: 'update_ogabassey_guest_cart',
      arguments: { product_id: charger, quantity: 1 },
    });
    expect(first.isError).not.toBe(true);
    const blocks = first.content.filter((block) => block.type === 'text');
    const continuation = blocks.find((block) =>
      block.annotations?.audience?.includes('assistant'),
    );
    if (!enabled) {
      expect(continuation).toBeUndefined();
      expect(first.structuredContent?.cart_token).toBeTypeOf('string');
      expect(JSON.stringify(first.content)).not.toContain(
        first.structuredContent?.cart_token,
      );
      return;
    }
    expect(continuation).toBeDefined();
    const state = JSON.parse(continuation?.text ?? 'null') as {
      cart_token: string;
    };
    const second = await client.callTool({
      name: 'update_ogabassey_guest_cart',
      arguments: {
        product_id: camera,
        quantity: 1,
        cart_token: state.cart_token,
      },
    });
    expect(second.isError).not.toBe(true);
    const next = second.content.find(
      (block) =>
        block.type === 'text' &&
        block.annotations?.audience?.includes('assistant'),
    );
    if (!next || next.type !== 'text')
      throw new Error('missing text continuation');
    const carried = JSON.parse(next.text) as { cart_token: string };
    const removed = await client.callTool({
      name: 'update_ogabassey_guest_cart',
      arguments: {
        product_id: charger,
        quantity: 0,
        cart_token: carried.cart_token,
      },
    });
    expect(removed.isError).not.toBe(true);
    expect(removed.structuredContent?.items).toEqual([
      { product_id: camera, quantity: 1 },
    ]);
    const final = removed.content.find(
      (block) =>
        block.type === 'text' &&
        block.annotations?.audience?.includes('assistant'),
    );
    if (!final || final.type !== 'text')
      throw new Error('missing final continuation');
    expect(JSON.parse(final.text)).not.toHaveProperty('cart_url');
    expect(JSON.parse(final.text)).toMatchObject({
      items: [{ product_id: camera, quantity: 1 }],
    });
  } finally {
    await client.close();
    await server.close();
  }
});
it('uses verified connection authority across fresh request servers without model-carried tokens', async () => {
  const fake = createFakeGuestCartSupabase();
  const store = new GuestCartStore(fake.supabase);
  const token = 'a'.repeat(64);
  fake.rows.set(token, { items: [], version: 1,
    expires_at: new Date(Date.now() + 3600_000).toISOString() });
  async function call(product_id: string, quantity: number) {
    const server = new McpServer({ name: 'oauth-cart-test', version: '1.0.0' });
    const client = new Client({ name: 'oauth-cart-client', version: '1.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    registerConfiguredGuestCartTool(server, {
      store,
      supabase: {} as SupabaseClient,
      getMerchantId: async () => 'merchant',
      formatPrice: String,
      connectionCart: { resolveToken: async () => token },
    });
    await server.connect(st);
    await client.connect(ct);
    try {
      const tools = await client.listTools();
      expect(tools.tools[0]?.inputSchema.properties).not.toHaveProperty(
        'cart_token',
      );
      const reply = await client.callTool({
        name: 'update_ogabassey_guest_cart',
        arguments: { product_id, quantity },
      });
      expect(JSON.stringify(reply)).not.toContain(token);
      expect(reply.isError).not.toBe(true);
      return reply;
    } finally {
      await client.close();
      await server.close();
    }
  }
  await call(charger, 1);
  await call(camera, 2);
  const result = await call(charger, 0);
  expect(result.structuredContent?.items).toEqual([
    { product_id: camera, quantity: 2 },
  ]);
});


it.each([false, true])('discovers one cart workflow for OAuth connection=%s', async (connected) => {
  const server = new McpServer({ name: 'cart-discovery', version: '1.0.0' });
  const client = new Client({ name: 'cart-discovery-client', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const resolveToken = vi.fn(async () => 'a'.repeat(64));
  registerConfiguredGuestCartTool(server, {
    store: new GuestCartStore(createFakeGuestCartSupabase().supabase),
    supabase: {} as SupabaseClient,
    getMerchantId: async () => 'merchant',
    formatPrice: String,
    ...(connected ? { connectionCart: { resolveToken } } : {}),
  });
  await server.connect(st);
  await client.connect(ct);
  try {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(connected
      ? ['get_ogabassey_guest_cart', 'update_ogabassey_guest_cart']
      : ['add_to_cart', 'prepare_storefront_cart_link', 'update_ogabassey_guest_cart']);
    // Discovery must not create a cart or resolve a private cart credential.
    expect(resolveToken).not.toHaveBeenCalled();
    if (connected) {
      for (const name of ['add_to_cart', 'prepare_storefront_cart_link']) {
        await expect(client.callTool({ name, arguments: { product_id: charger } }))
          .rejects.toThrow(`Tool ${name} not found`);
      }
      expect(resolveToken).not.toHaveBeenCalled();
    }
  } finally {
    await client.close();
    await server.close();
  }
});
