import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { afterEach, expect, it, vi } from 'vitest';
import { createFakeGuestCartSupabase } from './guest-cart-fake-supabase';
import { registerConfiguredGuestCartTool } from './guest-cart-registration';
import { GuestCartStore } from './guest-cart-store';
import { guestCredentialModeEnabled } from './guest-credential-cart';

vi.mock('./cart-handoff', () => ({
  prepareCartHandoff: vi
    .fn()
    .mockResolvedValue({ structuredContent: { success: true } }),
}));

const charger = '11111111-1111-4111-8111-111111111111';
const camera = '22222222-2222-4222-8222-222222222222';
const cartId = '33333333-3333-4333-8333-333333333333';
const handoffUrl =
  'https://ogabassey.com/cart#handoff=synthetic&hid=44444444-4444-4444-8444-444444444444';
const updateName = 'update_ogabassey_cart';
const readName = 'get_ogabassey_guest_cart';

afterEach(() => vi.unstubAllEnvs());

it('offers one no-OAuth cart workflow to the model, preserves the credential between calls and hands off the remaining lines', async () => {
  // Even an inherited text opt-in must not put the credential in content.
  vi.stubEnv('BACI_MCP_PRIVATE_TEXT_CONTINUATION', 'true');
  const { supabase, rows } = createFakeGuestCartSupabase();
  const items = new Map<string, number>();
  let version = 0;
  function state(cart_token: string) {
    return {
      cart_token,
      cart_url: handoffUrl,
      canonical_cart_id: cartId,
      version,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      items: [...items].map(([product_id, quantity]) => ({
        product_id,
        quantity,
      })),
    };
  }
  let urlAvailable = true;
  const bridge = {
    hasToken: async (token: string) => rows.has(token),
    update: vi.fn(
      async (token: string, edit: { product_id: string; quantity: number }) => {
        expect(rows.has(token)).toBe(true);
        if (edit.quantity === 0) items.delete(edit.product_id);
        else items.set(edit.product_id, edit.quantity);
        version += 1;
        return {
          ...state(token),
          cart_url: urlAvailable ? handoffUrl : undefined,
        };
      }
    ),
    read: vi.fn(async (token: string) => state(token)),
  };
  const store = new GuestCartStore(supabase, bridge);

  async function request<T>(run: (client: Client) => Promise<T>) {
    const server = new McpServer({
      name: 'guest-credential-test',
      version: '1.0.0',
    });
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    registerConfiguredGuestCartTool(server, {
      store,
      supabase,
      getMerchantId: async () => 'merchant',
      formatPrice: String,
      guestCredentialMode: true,
    });
    await server.connect(st);
    await client.connect(ct);
    try {
      return await run(client);
    } finally {
      await client.close();
      await server.close();
    }
  }

  const listed = await request((client) => client.listTools());
  expect(listed.tools.map(({ name }) => name).sort()).toEqual([
    readName,
    updateName,
    'update_ogabassey_guest_cart',
  ]);
  expect(
    listed.tools.every(
      (tool) =>
        JSON.stringify(tool._meta?.securitySchemes) === '[{"type":"noauth"}]'
    )
  ).toBe(true);
  expect(
    listed.tools.find(({ name }) => name === 'update_ogabassey_guest_cart')
      ?._meta?.ui
  ).toEqual({
    visibility: ['app'],
  });
  expect(
    listed.tools.find(({ name }) => name === updateName)?._meta?.ui
  ).toEqual({
    visibility: ['model'],
  });
  expect(rows.size).toBe(0);
  const call = (name: string, args: Record<string, unknown>) =>
    request((client) => client.callTool({ name, arguments: args }));
  const first = await call(updateName, { product_id: charger, quantity: 1 });
  const token = first.structuredContent?.cartCredential;
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(JSON.stringify(first.content)).not.toContain(token);
  expect(first.structuredContent?.cart_url).toBe(handoffUrl);
  await call(updateName, {
    product_id: camera,
    quantity: 2,
    cartCredential: token,
    expectedVersion: 1,
    operationId: 'add-camera',
  });
  const removal = await call(updateName, {
    product_id: charger,
    quantity: 0,
    cartCredential: token,
    expectedVersion: 2,
    operationId: 'remove-charger',
  });
  expect(removal.structuredContent).toMatchObject({
    success: true,
    cartCredential: token,
    cart_url: handoffUrl,
    items: [{ product_id: camera, quantity: 2 }],
  });
  const refresh = await call(readName, { cartCredential: token });
  expect(refresh.structuredContent).toMatchObject({
    success: true,
    cartCredential: token,
    cart_url: handoffUrl,
    items: [{ product_id: camera, quantity: 2 }],
  });
  expect(bridge.update).toHaveBeenCalledTimes(3);
  expect(bridge.read).toHaveBeenCalledWith(
    Buffer.from(String(token), 'base64url').toString('hex')
  );
  expect(rows.size).toBe(1);

  urlAvailable = false;
  const noHandoff = await call(updateName, {
    product_id: camera,
    quantity: 1,
    cartCredential: token,
    expectedVersion: 3,
    operationId: 'change-camera',
  });
  expect(noHandoff.structuredContent).toMatchObject({
    success: false,
    cartCredential: token,
    code: 'refresh_required',
  });
  expect(JSON.stringify(noHandoff)).not.toContain('guest_cart=');
});

it('keeps credential mode opt-in and requires an independent cart-only canonical instance', () => {
  expect(guestCredentialModeEnabled(false, {})).toBe(false);
  const env = { BACI_MCP_GUEST_CREDENTIAL_ENABLED: 'true' };
  expect(guestCredentialModeEnabled(true, env)).toBe(true);
  expect(() => guestCredentialModeEnabled(false, env)).toThrow(
    'canonical bridge'
  );
  expect(() =>
    guestCredentialModeEnabled(true, {
      ...env,
      BACI_MCP_GUEST_OAUTH_ENABLED: 'true',
    })
  ).toThrow('without guest OAuth');
  expect(() =>
    guestCredentialModeEnabled(true, {
      ...env,
      MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS: '1',
    })
  ).toThrow('cart-only');
});
