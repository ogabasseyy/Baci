import { supabase } from '@/lib/supabase';
import { resolveOfferStock } from './cart-stock-offers';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const mockRpc = supabase.rpc as jest.Mock;

function mockOfferCalls(args: {
  offers?: unknown[];
  offersError?: unknown;
  baseRow?: unknown;
  baseError?: unknown;
}) {
  mockRpc.mockImplementation(async (name: string) => {
    if (name === 'get_product_offers') {
      return { data: args.offers ?? [], error: args.offersError ?? null };
    }
    return {
      data: args.baseRow === undefined ? [] : [args.baseRow],
      error: args.baseError ?? null,
    };
  });
}

const BASE = { product_id: 'p1', effective_policy: 'managed' };

describe('resolveOfferStock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws a retryable error when the offer lookup fails', async () => {
    mockOfferCalls({ offersError: { message: 'boom' }, baseRow: BASE });
    await expect(resolveOfferStock('p1', 'o1', 7)).rejects.toThrow(
      'Cannot verify stock availability. Please try again.'
    );
  });

  it('reports zero when the offer is missing from the projection', async () => {
    mockOfferCalls({
      offers: [{ offer_id: 'other', stock_quantity: 5 }],
      baseRow: BASE,
    });
    await expect(resolveOfferStock('p1', 'o1', 7)).resolves.toEqual({
      stock: 0,
      strictUnits: null,
    });
  });

  it('throws when the base inventory lookup fails', async () => {
    mockOfferCalls({
      offers: [{ offer_id: 'o1', stock_quantity: 5 }],
      baseError: { message: 'boom' },
    });
    await expect(resolveOfferStock('p1', 'o1', 7)).rejects.toThrow(
      'Cannot verify stock availability. Please try again.'
    );
  });

  it('reports zero when the product is absent from the base projection', async () => {
    mockOfferCalls({ offers: [{ offer_id: 'o1', stock_quantity: 5 }] });
    await expect(resolveOfferStock('p1', 'o1', 7)).resolves.toEqual({
      stock: 0,
      strictUnits: null,
    });
  });

  it('caps a finite offer quantity by strict serialized units', async () => {
    mockOfferCalls({
      offers: [{ offer_id: 'o1', stock_quantity: 9 }],
      baseRow: {
        ...BASE,
        effective_policy: 'serialized_strict',
        available_units: 4,
      },
    });
    await expect(resolveOfferStock('p1', 'o1', 7)).resolves.toEqual({
      stock: 4,
      strictUnits: 4,
    });
  });

  it('inherits strict units when the offer quantity is null', async () => {
    mockOfferCalls({
      offers: [{ offer_id: 'o1', stock_quantity: null }],
      baseRow: {
        ...BASE,
        effective_policy: 'serialized_strict',
        available_units: 4,
      },
    });
    await expect(resolveOfferStock('p1', 'o1', 7)).resolves.toEqual({
      stock: 4,
      strictUnits: 4,
    });
  });

  it('throws when strict policy reports no unit count', async () => {
    mockOfferCalls({
      offers: [{ offer_id: 'o1', stock_quantity: 9 }],
      baseRow: { ...BASE, effective_policy: 'serialized_strict' },
    });
    await expect(resolveOfferStock('p1', 'o1', 7)).rejects.toThrow(
      'Cannot verify stock availability. Please try again.'
    );
  });

  it('bypasses the cap for unlimited tracking with a null offer quantity', async () => {
    mockOfferCalls({
      offers: [{ offer_id: 'o1', stock_quantity: null }],
      baseRow: { ...BASE, effective_policy: 'serialized_then_unlimited' },
    });
    await expect(resolveOfferStock('p1', 'o1', 7)).resolves.toEqual({
      stock: Number.MAX_SAFE_INTEGER,
      strictUnits: null,
    });
  });

  it('uses the finite offer quantity under unlimited tracking', async () => {
    mockOfferCalls({
      offers: [{ offer_id: 'o1', stock_quantity: 9 }],
      baseRow: { ...BASE, effective_policy: 'serialized_then_unlimited' },
    });
    await expect(resolveOfferStock('p1', 'o1', 7)).resolves.toEqual({
      stock: 9,
      strictUnits: null,
    });
  });

  it('falls back to parent stock when the offer quantity is null', async () => {
    mockOfferCalls({
      offers: [{ offer_id: 'o1', stock_quantity: null }],
      baseRow: BASE,
    });
    await expect(resolveOfferStock('p1', 'o1', 7)).resolves.toEqual({
      stock: 7,
      strictUnits: null,
    });
  });
});
