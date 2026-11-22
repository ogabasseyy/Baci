import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadNegotiationRequests } from './load-negotiation-requests';

const { from, eq, inFilter, results } = vi.hoisted(() => ({
  from: vi.fn(),
  eq: vi.fn(),
  inFilter: vi.fn(),
  results: [] as unknown[],
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

beforeEach(() => {
  vi.clearAllMocks();
  results.length = 0;
  from.mockImplementation(() => {
    const result = results.shift();
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((...args) => {
        eq(...args);
        return chain;
      }),
      in: vi.fn((...args) => {
        inFilter(...args);
        return Promise.resolve(result);
      }),
      order: vi.fn(() => Promise.resolve(result)),
    };
    return chain;
  });
});

describe('loadNegotiationRequests', () => {
  it('loads the full customer name using auth user ID and scopes both reads to the merchant', async () => {
    results.push(
      {
        data: [
          {
            id: 'n1',
            customer_id: 'auth-user',
            item_info: { current_price: 100 },
            cart_snapshot: {},
          },
        ],
        error: null,
      },
      {
        data: [
          {
            user_id: 'auth-user',
            first_name: 'Chidi',
            last_name: 'Okeke',
            full_name: null,
          },
        ],
        error: null,
      }
    );
    const rows = await loadNegotiationRequests('merchant-1');
    expect(rows[0]).toMatchObject({
      customer_name: 'Chidi Okeke',
      current_price: 100,
      cart_snapshot: null,
    });
    expect(eq.mock.calls).toEqual([
      ['merchant_id', 'merchant-1'],
      ['merchant_id', 'merchant-1'],
    ]);
    expect(inFilter).toHaveBeenCalledWith('user_id', ['auth-user']);
  });

  it('keeps guest requests readable when no customer profile exists', async () => {
    results.push({ data: [{ id: 'guest', customer_id: null }], error: null });
    expect(
      (await loadNegotiationRequests('merchant-1'))[0].customer_name
    ).toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('finds a known guest name by email within the same merchant', async () => {
    results.push(
      {
        data: [
          {
            id: 'n1',
            customer_id: null,
            customer_email: ' Guest@Example.com ',
          },
        ],
        error: null,
      },
      {
        data: [{ email: 'guest@example.com', full_name: 'Chidi Okeke' }],
        error: null,
      }
    );
    expect((await loadNegotiationRequests('merchant-1'))[0].customer_name).toBe(
      'Chidi Okeke'
    );
    expect(inFilter).toHaveBeenCalledWith('email', ['guest@example.com']);
    expect(eq).toHaveBeenNthCalledWith(2, 'merchant_id', 'merchant-1');
  });

  it('keeps requests and successful names if another lookup batch fails', async () => {
    const data = Array.from({ length: 21 }, (_, index) => ({
      id: `request-${index}`,
      customer_id: `user-${index}`,
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      results.push(
        { data, error: null },
        { data: null, error: new Error('Customer lookup failed') },
        {
          data: [{ user_id: 'user-20', full_name: 'Chidi Okeke' }],
          error: null,
        }
      );
      const rows = await loadNegotiationRequests('merchant-1');
      expect(rows).toHaveLength(21);
      expect(rows[0].customer_name).toBeNull();
      expect(rows[20].customer_name).toBe('Chidi Okeke');
      expect(inFilter.mock.calls.map(([, batch]) => batch.length)).toEqual([
        20, 1,
      ]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it('surfaces query errors', async () => {
    results.push({ data: null, error: new Error('Read failed') });
    await expect(loadNegotiationRequests('merchant-1')).rejects.toThrow(
      'Read failed'
    );
  });
});
