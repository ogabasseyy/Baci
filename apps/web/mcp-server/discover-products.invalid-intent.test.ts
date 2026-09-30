import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { discoverMcpProducts } from './discover-products';

describe('discovery invalid intent', () => {
  it('returns validation feedback instead of throwing on an intent the schema rejects', async () => {
    const result = await discoverMcpProducts({
      args: {
        intent: { alternatives: [{ product_type: 'phone', bogus: 'field' }] } as unknown as McpDiscoveryIntent,
        query: 'phone',
      },
      merchantId: 'merchant',
      sanitizeString: (value) => value,
      supabase: {} as unknown as SupabaseClient,
    });
    expect(result.selectedProducts).toEqual([]);
    expect('invalidIntentMessage' in result ? result.invalidIntentMessage : undefined).toMatch(/Invalid search intent/);
  });
});
