import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';
import { loadMcpProductVariants } from './product-variants';
import { createSupabase } from './product-variants-test-fixtures';

describe('variant output failure contracts', () => {
  it('distinguishes an option lookup failure from no listed options, even without colors', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'Fixture unavailable' } });
    const result = await loadMcpProductVariants({
      args: { product_id: 'phone-1' }, merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value, formatPrice: String,
    });
    expect(result.structuredContent).toMatchObject({
      status: 'unavailable', variant_lookup_failed: true, variants: [], condition_offers: [],
      catalog_colors: { labels: [], source: null },
    });
    expect(mcpToolOutputSchemas.get_product_variants.safeParse(result.structuredContent).success).toBe(true);
  });

  it('returns a structured invalid-input result without querying the catalog', async () => {
    const supabase = createSupabase();
    const result = await loadMcpProductVariants({
      args: {}, merchantId: 'merchant-1', supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value, formatPrice: String,
    });
    expect(result.structuredContent).toMatchObject({ status: 'invalid_input', variants: [], condition_offers: [] });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mcpToolOutputSchemas.get_product_variants.safeParse(result.structuredContent).success).toBe(true);
  });
});
