import type { McpServer } from '@modelcontextprotocol/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { GuestCartCanonicalError } from './guest-cart-errors';
import { createFakeGuestCartSupabase } from './guest-cart-fake-supabase';
import { GuestCartStore } from './guest-cart-store';
import { registerGuestCartTool } from './guest-cart-tool';

const validate = vi.hoisted(() => vi.fn());
vi.mock('./cart-handoff', () => ({ prepareCartHandoff: validate }));
const id = '11111111-1111-4111-8111-111111111111';
type Args = { product_id: string; quantity: number; cart_token?: string };
function handlerFor(store: GuestCartStore) {
  let handler: ((args: Args) => Promise<unknown>) | undefined;
  const registerTool = vi.fn(
    (
      _name: string,
      _config: unknown,
      callback: (args: Args) => Promise<unknown>
    ) => {
      handler = callback;
    }
  );
  registerGuestCartTool({ registerTool } as unknown as McpServer, {
    store,
    supabase: {} as SupabaseClient,
    getMerchantId: async () => 'merchant',
    formatPrice: String,
  });
  return { handler: handler as (args: Args) => Promise<unknown> };
}

it('continues one multi-item cart across text-only tool-result turns', async () => {
  const fake = createFakeGuestCartSupabase();
  const { handler } = handlerFor(new GuestCartStore(fake.supabase));
  validate.mockResolvedValue({ structuredContent: { success: true } });
  const camera = '22222222-2222-4222-8222-222222222222';
  const cable = '33333333-3333-4333-8333-333333333333';
  // Reproduce clients that carry only text blocks into the next turn.
  // Never read structuredContent to recover the authority for an update.
  async function nextTurn(args: Args) {
    const result = (await handler(args)) as {
      content: {
        type: string;
        text: string;
        annotations?: { audience?: string[] };
      }[];
      structuredContent: unknown;
    };
    const block = result.content.find((part) => part.text.startsWith('{'));
    expect(
      block,
      'text transcript must preserve the next-turn cart authority'
    ).toBeDefined();
    expect(block?.annotations?.audience).toEqual(['assistant']);
    const state = JSON.parse(block?.text ?? 'null') as {
      success: boolean;
      cart_token: string;
      items: { product_id: string; quantity: number }[];
      cart_emptied?: boolean;
    };
    expect(state).toEqual(result.structuredContent);
    expect(state.success).toBe(true);
    return state;
  }
  const first = await nextTurn({ product_id: id, quantity: 1 });
  const second = await nextTurn({
    product_id: camera,
    quantity: 1,
    cart_token: first.cart_token,
  });
  const third = await nextTurn({
    product_id: cable,
    quantity: 2,
    cart_token: second.cart_token,
  });
  expect(third.items).toHaveLength(3);
  const removed = await nextTurn({
    product_id: id,
    quantity: 0,
    cart_token: third.cart_token,
  });
  expect(removed.cart_token).toBe(first.cart_token);
  expect(removed.items).toEqual([
    { product_id: camera, quantity: 1 },
    { product_id: cable, quantity: 2 },
  ]);
  const remaining = await nextTurn({
    product_id: cable,
    quantity: 0,
    cart_token: removed.cart_token,
  });
  expect(remaining.items).toEqual([{ product_id: camera, quantity: 1 }]);
  const empty = await nextTurn({
    product_id: camera,
    quantity: 0,
    cart_token: remaining.cart_token,
  });
  expect(empty.items).toEqual([]);
  expect(empty.cart_emptied).toBe(true);
});

it('preserves canonical retry authority and version in the text transcript, but not after denial', async () => {
  const store = new GuestCartStore(createFakeGuestCartSupabase().supabase);
  const { handler } = handlerFor(store);
  const token = 'a'.repeat(64);
  const update = vi
    .spyOn(store, 'update')
    .mockRejectedValueOnce(
      new GuestCartCanonicalError('version_conflict', token, id, 7)
    );
  const result = (await handler({
    product_id: id,
    quantity: 0,
    cart_token: token,
  })) as {
    content: { text: string }[];
    structuredContent: unknown;
  };
  const state = JSON.parse(result.content.at(-1)?.text ?? 'null');
  expect(state).toEqual(result.structuredContent);
  expect(state).toMatchObject({
    success: false,
    retryable: true,
    cart_token: token,
    version: 7,
  });
  update.mockRejectedValueOnce(
    new GuestCartCanonicalError('unauthorized', token)
  );
  const denied = await handler({
    product_id: id,
    quantity: 0,
    cart_token: token,
  });
  expect(denied).toMatchObject({
    structuredContent: {
      success: false,
      code: 'unauthorized',
      retryable: false,
    },
  });
  expect(update).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(denied)).not.toContain(token);
});
