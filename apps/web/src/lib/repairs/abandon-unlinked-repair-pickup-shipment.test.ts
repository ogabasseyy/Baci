import { describe, expect, it, vi } from 'vitest';
import { abandonUnlinkedRepairPickupShipment } from './abandon-unlinked-repair-pickup-shipment';

describe('abandonUnlinkedRepairPickupShipment', () => {
  it('deletes only pending unlinked repair pickup shipments', async () => {
    const select = vi.fn().mockResolvedValue({
      data: [{ id: 'ship-1' }],
      error: null,
    });
    const eq = vi.fn().mockReturnThis();
    const is = vi.fn().mockReturnThis();
    const deleteMock = vi.fn().mockReturnValue({ eq, is, select });
    // Terminal status filter returns the select() promise.
    eq.mockImplementation(function (this: { select: typeof select }) {
      return { eq, is, select };
    });
    is.mockImplementation(() => ({ eq, is, select }));
    const supabase = {
      from: vi.fn().mockReturnValue({ delete: deleteMock }),
    };

    const result = await abandonUnlinkedRepairPickupShipment(
      supabase as never,
      'merchant-1',
      'ship-1'
    );

    expect(result).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('shipments');
    expect(deleteMock).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('id', 'ship-1');
    expect(eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(eq).toHaveBeenCalledWith('status', 'pending');
    expect(is).toHaveBeenCalledWith('order_id', null);
    expect(is).toHaveBeenCalledWith('provider_shipment_id', null);
    expect(is).toHaveBeenCalledWith('tracking_number', null);
    expect(select).toHaveBeenCalledWith('id');
  });

  it('returns false when the delete fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = {
      from: vi.fn().mockReturnValue({
        delete: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                is: () => ({
                  is: () => ({
                    eq: () => ({
                      select: () =>
                        Promise.resolve({
                          error: { message: 'delete failed' },
                        }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    };

    const result = await abandonUnlinkedRepairPickupShipment(
      supabase as never,
      'merchant-1',
      'ship-1'
    );

    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });

  it('returns false when no pending unlinked shipment row matched', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = {
      from: vi.fn().mockReturnValue({
        delete: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                is: () => ({
                  is: () => ({
                    eq: () => ({
                      select: () =>
                        Promise.resolve({
                          data: [],
                          error: null,
                        }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    };

    const result = await abandonUnlinkedRepairPickupShipment(
      supabase as never,
      'merchant-1',
      'ship-1'
    );

    expect(result).toBe(false);
    consoleSpy.mockRestore();
  });
});
