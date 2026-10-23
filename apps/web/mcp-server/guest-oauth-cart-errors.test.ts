import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { GuestCartCanonicalError } from './guest-cart-errors';
import { registerConfiguredGuestCartTool } from './guest-cart-registration';
it('returns version-conflict recovery without asking the model for a private capability', async () => {
  const token = 'c'.repeat(64);
  const server = new McpServer({ name: 'oauth-error', version: '1.0.0' });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  registerConfiguredGuestCartTool(server, { store: { hasToken: async () => true, update: vi.fn().mockRejectedValue(new GuestCartCanonicalError('version_conflict', token, null, 2)) },
    supabase: {} as SupabaseClient, getMerchantId: async () => 'merchant', formatPrice: String,
    connectionCart: { resolveToken: async () => token } });
  await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: 'update_ogabassey_guest_cart', arguments: { product_id: '11111111-1111-4111-8111-111111111111', quantity: 0 } });
    expect(result.structuredContent).toMatchObject({ success: false, code: 'version_conflict', version: 2 });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result.content)).not.toContain('cart_token');
    expect(JSON.stringify(result.content)).toContain('connection');
  } finally { await client.close(); await server.close(); }
});
