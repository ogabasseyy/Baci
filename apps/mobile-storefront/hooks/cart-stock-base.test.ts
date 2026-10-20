import { supabase } from '@/lib/supabase';
import { resolveBaseStock } from './cart-stock-base';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const mockRpc = supabase.rpc as jest.Mock;

function mockBaseRow(row: unknown) {
  mockRpc.mockResolvedValue({
    data: row === undefined ? [] : [row],
    error: null,
  });
}

describe('resolveBaseStock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws a retryable error when the projection lookup fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(resolveBaseStock('p1', 7)).rejects.toThrow(
      'Cannot verify stock availability. Please try again.'
    );
  });

  it('reports zero when the product is absent from the projection', async () => {
    mockBaseRow({ product_id: 'other', effective_policy: 'x' });
    await expect(resolveBaseStock('p1', 7)).resolves.toEqual({
      stock: 0,
      strictUnits: null,
    });
  });

  it('reports zero when the projection returns a non-array payload', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(resolveBaseStock('p1', 7)).resolves.toEqual({
      stock: 0,
      strictUnits: null,
    });
  });

  it('bypasses the cap for unlimited tracking', async () => {
    mockBaseRow({
      product_id: 'p1',
      effective_policy: 'serialized_then_unlimited',
    });
    await expect(resolveBaseStock('p1', 7)).resolves.toEqual({
      stock: Number.MAX_SAFE_INTEGER,
      strictUnits: null,
    });
  });

  it('returns exact units and the shared pool for strict policy', async () => {
    mockBaseRow({
      product_id: 'p1',
      effective_policy: 'serialized_strict',
      available_units: 3,
    });
    await expect(resolveBaseStock('p1', 7)).resolves.toEqual({
      stock: 3,
      strictUnits: 3,
    });
  });

  it('clamps negative strict units to zero', async () => {
    mockBaseRow({
      product_id: 'p1',
      effective_policy: 'serialized_strict',
      available_units: -2,
    });
    await expect(resolveBaseStock('p1', 7)).resolves.toEqual({
      stock: 0,
      strictUnits: 0,
    });
  });

  it('throws when strict policy reports no unit count', async () => {
    mockBaseRow({ product_id: 'p1', effective_policy: 'serialized_strict' });
    await expect(resolveBaseStock('p1', 7)).rejects.toThrow(
      'Cannot verify stock availability. Please try again.'
    );
  });

  it('falls back to parent stock for other policies', async () => {
    mockBaseRow({ product_id: 'p1', effective_policy: 'managed' });
    await expect(resolveBaseStock('p1', 7)).resolves.toEqual({
      stock: 7,
      strictUnits: null,
    });
  });
});
