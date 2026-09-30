import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { discoverMcpProducts } from './discover-products';

const { discoverStructuredProducts } = vi.hoisted(() => ({ discoverStructuredProducts: vi.fn() }));

vi.mock('./discover-structured-products', () => ({ discoverStructuredProducts }));

const supabase = {} as SupabaseClient;
const validIntent: McpDiscoveryIntent = { alternatives: [{ product_type: 'phone' }] };

describe('discoverMcpProducts structured routing', () => {
  beforeEach(() => discoverStructuredProducts.mockReset());

  it('asks for intent when it is missing and never runs a lexical search', async () => {
    const result = await discoverMcpProducts({
      args: { query: ' affordable phone ' },
      merchantId: 'merchant',
      sanitizeString: (value) => value.trim(),
      supabase,
    });

    expect(result.selectedProducts).toEqual([]);
    expect(result.invalidIntentMessage).toMatch(/intent is required/i);
    expect(result.sanitizedQuery).toBe('affordable phone');
    expect(discoverStructuredProducts).not.toHaveBeenCalled();
  });

  it('returns safe feedback for malformed intent', async () => {
    const result = await discoverMcpProducts({
      args: {
        intent: { alternatives: [{ product_type: 'phone', unexpected: true }] } as unknown as McpDiscoveryIntent,
        query: 'phone',
      },
      merchantId: 'merchant',
      sanitizeString: (value) => value,
      supabase,
    });

    expect(result.selectedProducts).toEqual([]);
    expect(result.invalidIntentMessage).toMatch(/Invalid search intent/);
    expect(discoverStructuredProducts).not.toHaveBeenCalled();
  });

  it('routes a validated intent through structured discovery with sanitized retrieval keywords', async () => {
    discoverStructuredProducts.mockResolvedValue({ selectedProducts: [], sanitizedQuery: 'iPhone 15', priceScanComplete: true });
    const semanticSearch = vi.fn(async () => []);

    const result = await discoverMcpProducts({
      args: { intent: validIntent, query: '  iPhone 15  ', limit: 4 },
      merchantId: 'merchant',
      sanitizeString: (value) => value.trim(),
      semanticSearch,
      supabase,
    });

    expect(result.sanitizedQuery).toBe('iPhone 15');
    expect(discoverStructuredProducts).toHaveBeenCalledWith(expect.objectContaining({
      intent: validIntent,
      query: 'iPhone 15',
      merchantId: 'merchant',
      semanticSearch,
      supabase,
    }));
  });

  it('sanitizes and trims catalog filters and omits a blank condition', async () => {
    const sanitizeString = vi.fn((value: string) => value.replaceAll('<unsafe>', ''));
    discoverStructuredProducts.mockResolvedValue({ selectedProducts: [], sanitizedQuery: undefined, priceScanComplete: true });

    await discoverMcpProducts({
      args: {
        intent: validIntent,
        brand: ' <unsafe> Apple  ',
        category: '  Smartphones <unsafe> ',
        condition: '   ',
      },
      merchantId: 'merchant',
      sanitizeString,
      supabase,
    });

    expect(discoverStructuredProducts).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.objectContaining({ brand: 'Apple', category: 'Smartphones', condition: undefined }),
    }));
    expect(sanitizeString).toHaveBeenNthCalledWith(1, ' <unsafe> Apple  ', 50);
    expect(sanitizeString).toHaveBeenNthCalledWith(2, '  Smartphones <unsafe> ', 50);
    expect(sanitizeString).toHaveBeenNthCalledWith(3, '   ', 50);
  });
});
