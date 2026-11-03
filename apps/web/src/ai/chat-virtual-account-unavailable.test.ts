import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAgenticScopedSupabaseClient: vi.fn(),
}));
vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: mocks.createAgenticScopedSupabaseClient,
}));

import { handleCreateVirtualAccount } from './chat-tool-handlers';

it('does not create a pending order when virtual-account payments are unavailable', async () => {
  const result = await handleCreateVirtualAccount(
    {
      amount: 100,
      customerEmail: 'test@example.com',
      customerName: 'Test Customer',
      items: [
        { productId: 'product-1', name: 'Product', price: 100, quantity: 1 },
      ],
    },
    'test-session'
  );

  expect(result.success).toBe(false);
  expect(result.error).toContain('temporarily unavailable');
  expect(result.orderId).toBeUndefined();
  expect(mocks.createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
});
