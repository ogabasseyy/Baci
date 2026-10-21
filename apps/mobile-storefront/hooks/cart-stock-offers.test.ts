import { supabase } from '@/lib/supabase';
import { resolveOfferStock } from './cart-stock-offers';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const mockRpc = supabase.rpc as jest.Mock;

function mockAuthority(args: { rows?: unknown[]; error?: unknown }) {
  mockRpc.mockImplementation(async (name: string) => {
    if (name === 'get_storefront_offer_resolution') {
      return { data: args.rows ?? [], error: args.error ?? null };
    }
    throw new Error(`unexpected rpc: ${name}`);
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    product_id: 'p1',
    offer_id: 'o1',
    condition: 'used',
    price_basis: 80,
    allocatable_stock: 5,
    parent_eligible: true,
    effective_policy: 'legacy',
    available_units: null,
    ...overrides,
  };
}

describe('resolveOfferStock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws a retryable error when the offer lookup fails', async () => {
    mockAuthority({ error: { message: 'boom' } });
    await expect(resolveOfferStock('p1', 'o1')).rejects.toThrow(
      'Cannot verify stock availability. Please try again.'
    );
  });

  it('reports zero when the offer is missing from the projection', async () => {
    mockAuthority({ rows: [row({ offer_id: 'other' })] });
    await expect(resolveOfferStock('p1', 'o1')).resolves.toEqual({
      stock: 0,
      strictUnits: null,
    });
  });

  it('reports zero for a gated-out row a partial projection still carries', async () => {
    mockAuthority({ rows: [row({ parent_eligible: false })] });
    await expect(resolveOfferStock('p1', 'o1')).resolves.toEqual({
      stock: 0,
      strictUnits: null,
    });
  });

  it('reports the authority allocation on legacy policies', async () => {
    mockAuthority({ rows: [row({ allocatable_stock: 5 })] });
    await expect(resolveOfferStock('p1', 'o1')).resolves.toEqual({
      stock: 5,
      strictUnits: null,
    });
  });

  it('reports strict stock with the shared serialized pool', async () => {
    mockAuthority({
      rows: [
        row({
          allocatable_stock: 4,
          effective_policy: 'serialized_strict',
          available_units: 4,
        }),
      ],
    });
    await expect(resolveOfferStock('p1', 'o1')).resolves.toEqual({
      stock: 4,
      strictUnits: 4,
    });
  });

  it('fails closed to zero when strict policy reports no unit count', async () => {
    mockAuthority({
      rows: [
        row({
          allocatable_stock: null,
          effective_policy: 'serialized_strict',
          available_units: null,
        }),
      ],
    });
    await expect(resolveOfferStock('p1', 'o1')).resolves.toEqual({
      stock: 0,
      strictUnits: 0,
    });
  });

  it('treats unlimited null allocations as unbounded', async () => {
    mockAuthority({
      rows: [
        row({
          allocatable_stock: null,
          effective_policy: 'serialized_then_unlimited',
        }),
      ],
    });
    await expect(resolveOfferStock('p1', 'o1')).resolves.toEqual({
      stock: Number.MAX_SAFE_INTEGER,
      strictUnits: null,
    });
  });

  it('fails closed to zero when a non-unlimited policy has no allocation', async () => {
    mockAuthority({
      rows: [
        row({
          allocatable_stock: null,
          effective_policy: 'legacy',
        }),
      ],
    });
    await expect(resolveOfferStock('p1', 'o1')).resolves.toEqual({
      stock: 0,
      strictUnits: null,
    });
  });

  it('uses the finite allocation under unlimited tracking', async () => {
    mockAuthority({
      rows: [
        row({
          allocatable_stock: 9,
          effective_policy: 'serialized_then_unlimited',
        }),
      ],
    });
    await expect(resolveOfferStock('p1', 'o1')).resolves.toEqual({
      stock: 9,
      strictUnits: null,
    });
  });
});
