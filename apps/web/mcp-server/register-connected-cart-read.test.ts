import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, type Mock, vi } from 'vitest';
import { createFakeGuestCartSupabase } from './guest-cart-fake-supabase';
import { registerConfiguredGuestCartTool } from './guest-cart-registration';
import type { GuestCartStoreLike } from './guest-cart-health';
import { GuestCartStore } from './guest-cart-store';
import { registerConnectedCartRead } from './register-connected-cart-read';

type CartReader = NonNullable<GuestCartStoreLike['readConnectionCart']>;
const READ_TOOL = 'get_ogabassey_guest_cart';
const UPDATE_TOOL = 'update_ogabassey_guest_cart';
const BARE_CART_URL = 'https://ogabassey.com/cart';
const token = 'd'.repeat(64);
const lineItem = { product_id: '11111111-1111-4111-8111-111111111111', quantity: 2 };

it('refreshes the verified connection cart without exposing its capability', async () => {
  const read = vi
    .fn()
    .mockResolvedValue({
      cart_token: token,
      items: [lineItem],
      expires_at: '2099-01-01T00:00:00.000Z',
      cart_url:
        'https://ogabassey.com/cart#handoff=ch1.fixture.signature&hid=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      canonical_cart_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      version: 3,
    });
  const server = new McpServer({ name: 'cart-reader', version: '1.0.0' });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const update = vi.fn();
  registerConnectedCartRead(
    server,
    { update, hasToken: async () => true, readConnectionCart: read },
    { resolveToken: async () => token },
  );
  await server.connect(st);
  await client.connect(ct);
  try {
    const tools = await client.listTools();
    expect(tools.tools.find((tool) => tool.name === READ_TOOL)?.annotations?.idempotentHint).toBe(false);
    const result = await client.callTool({ name: READ_TOOL, arguments: {} });
    expect(read).toHaveBeenCalledWith(token);
    expect(result.structuredContent).toMatchObject({
      success: true,
      connection_bound: true,
      version: 3,
    });
    expect(JSON.stringify(result)).not.toContain(token);
    // Recover a reported broken link by reading the same owned cart,
    // without replaying the earlier add/remove operation.
    const freshUrl =
      'https://ogabassey.com/cart#handoff=ch1.fresh.signature&hid=cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    read.mockResolvedValueOnce({
      cart_token: token,
      items: [lineItem],
      expires_at: '2099-01-01T00:00:00.000Z',
      cart_url: freshUrl,
      canonical_cart_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      version: 3,
    });
    const recovered = await client.callTool({ name: READ_TOOL, arguments: {} });
    expect(recovered.structuredContent).toMatchObject({
      success: true,
      connection_bound: true,
      cart_url: freshUrl,
      items: [lineItem],
      canonical_cart_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      version: 3,
    });
    expect(update).not.toHaveBeenCalled();
    expect(JSON.stringify(recovered)).not.toContain(token);
    read.mockRejectedValueOnce(new Error(`private ${token}`));
    const failed = await client.callTool({ name: READ_TOOL, arguments: {} });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain(token);
  } finally {
    await client.close();
    await server.close();
  }
});

async function withConnectedReader<T>(
  readConnectionCart: Mock<CartReader>,
  run: (client: Client, update: ReturnType<typeof vi.fn>) => Promise<T>,
) {
  const server = new McpServer({ name: 'cart-reader', version: '1.0.0' });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const update = vi.fn();
  registerConnectedCartRead(
    server,
    { update, hasToken: async () => true, readConnectionCart },
    { resolveToken: async () => token },
  );
  await server.connect(st);
  await client.connect(ct);
  try {
    return await run(client, update);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('bugfix: broken connected-cart link recovery guidance', () => {
  it('lists both connected cart tools so a model routes a broken-link report to the read tool, not the mutation', async () => {
    const server = new McpServer({ name: 'cart-discovery', version: '1.0.0' });
    const client = new Client({ name: 'cart-discovery-client', version: '1.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const { supabase } = createFakeGuestCartSupabase();
    registerConfiguredGuestCartTool(server, {
      store: new GuestCartStore(supabase),
      supabase: {} as SupabaseClient,
      getMerchantId: async () => 'merchant',
      formatPrice: String,
      connectionCart: { resolveToken: async () => token },
    });
    await server.connect(st);
    await client.connect(ct);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([READ_TOOL, UPDATE_TOOL]);
      const read = tools.find((tool) => tool.name === READ_TOOL);
      const update = tools.find((tool) => tool.name === UPDATE_TOOL);
      const readGuidance = read?.description ?? '';
      const updateGuidance = update?.description ?? '';

      // The read tool claims every way a shopper reports a dead link and
      // forbids the two wrong repairs (replaying a write, minting a cart).
      expect(readGuidance).toMatch(/link ended, expired, is invalid or does not work/);
      expect(readGuidance).toMatch(/call this tool once to refresh the link/);
      expect(readGuidance).toMatch(/Do not replay add\/remove operations or create a replacement cart/);

      // The mutation tool redirects a broken-link report to the read tool by
      // its registered name and says not to repeat the mutation.
      expect(updateGuidance).toContain(`use ${READ_TOOL} to refresh that link`);
      expect(updateGuidance).toMatch(/do not repeat this mutation to repair it/);

      // Routing metadata also favours the read tool for a repair: it is not
      // destructive, while the update tool can remove lines.
      expect(read?.annotations?.destructiveHint).toBe(false);
      expect(update?.annotations?.destructiveHint).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    ['the cart read throws', vi.fn<CartReader>().mockRejectedValue(new Error(`private ${token}`))],
    [
      'the cart has items but no link',
      vi.fn<CartReader>().mockResolvedValue({
        cart_token: token,
        items: [lineItem],
        expires_at: '2099-01-01T00:00:00.000Z',
        canonical_cart_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        version: 3,
      }),
    ],
  ])('does not tell the model to retry when %s', async (_label, read) => {
    await withConnectedReader(read, async (client) => {
      const failed = await client.callTool({ name: READ_TOOL, arguments: {} });
      expect(failed.isError).toBe(true);
      expect(failed.structuredContent).toMatchObject({ success: false, connection_bound: true });
      const text = JSON.stringify(failed.content);
      expect(text).not.toMatch(/retry/i);
      expect(text).toMatch(/did not work/);
      expect(text).toMatch(/do not claim the cart or link was recovered/i);
      expect(text).not.toContain(token);

      // The failure text must agree with the single-attempt tool guidance.
      const { tools } = await client.listTools();
      const guidance = tools.find((tool) => tool.name === READ_TOOL)?.description ?? '';
      expect(guidance).toMatch(/rather than retrying again/);
    });
  });

  it('returns success with no items and the plain cart page for an empty cart, without writing', async () => {
    const read = vi.fn<CartReader>().mockResolvedValue({
      cart_token: token,
      items: [],
      expires_at: '2099-01-01T00:00:00.000Z',
      canonical_cart_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      version: 1,
    });
    await withConnectedReader(read, async (client, update) => {
      const { tools } = await client.listTools();
      const guidance = tools.find((tool) => tool.name === READ_TOOL)?.description ?? '';
      // The prompt documents this exact branch, so the model is not told it
      // received an edited or invented link.
      expect(guidance).toMatch(/Return the cart_url from the result unchanged/);
      expect(guidance).toMatch(/empty, the cart_url may be only the plain cart page/);
      expect(guidance).toMatch(/no saved items to recover/);
      expect(guidance).toMatch(/never repopulate it from chat history/);

      const empty = await client.callTool({ name: READ_TOOL, arguments: {} });
      expect(empty.isError).not.toBe(true);
      expect(empty.structuredContent).toMatchObject({
        success: true,
        connection_bound: true,
        items: [],
        cart_url: BARE_CART_URL,
        canonical_cart_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        version: 1,
      });
      expect(read).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
      expect(JSON.stringify(empty)).not.toContain(token);
    });
  });
});
