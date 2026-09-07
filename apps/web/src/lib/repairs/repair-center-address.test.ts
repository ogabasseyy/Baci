import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRepairCenterAddress,
  RepairCenterLookupError,
} from './repair-center-address';

const mocks = vi.hoisted(() => ({
  createRepairPickupReceiverClient: vi.fn(),
}));

vi.mock('./repair-pickup-receiver-client', () => ({
  createRepairPickupReceiverClient: mocks.createRepairPickupReceiverClient,
}));

const merchantId = '123e4567-e89b-12d3-a456-426614174000';

function makeClient(result: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
  };
}

const completeProjection = {
  name: 'Ogabassey Repair Center',
  phone: '09070007000',
  email: 'repairs@ogabassey.com',
  address: '3 Olayeni Street, Computer Village',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

describe('getRepairCenterAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the merchant id is empty', async () => {
    const result = await getRepairCenterAddress('');
    expect(result).toBeNull();
    expect(mocks.createRepairPickupReceiverClient).not.toHaveBeenCalled();
  });

  it('returns null when the projection is empty', async () => {
    const supabase = makeClient({ data: {}, error: null });
    mocks.createRepairPickupReceiverClient.mockReturnValue(supabase);
    expect(await getRepairCenterAddress(merchantId)).toBeNull();
    expect(mocks.createRepairPickupReceiverClient).toHaveBeenCalledWith(
      merchantId,
      expect.any(Date),
      'server-quote'
    );
    expect(supabase.rpc).toHaveBeenCalledWith('get_repair_pickup_receiver', {
      p_merchant_id: merchantId,
    });
  });

  it('returns null when the projection is not an object', async () => {
    const supabase = makeClient({ data: 'not-an-object', error: null });
    mocks.createRepairPickupReceiverClient.mockReturnValue(supabase);
    expect(await getRepairCenterAddress(merchantId)).toBeNull();
  });

  it('returns null when the address is incomplete', async () => {
    const supabase = makeClient({
      data: { address: '3 Olayeni Street' },
      error: null,
    });
    mocks.createRepairPickupReceiverClient.mockReturnValue(supabase);
    expect(await getRepairCenterAddress(merchantId)).toBeNull();
  });

  it('returns null when the projection omits a contact phone', async () => {
    const supabase = makeClient({
      data: { ...completeProjection, phone: '' },
      error: null,
    });
    mocks.createRepairPickupReceiverClient.mockReturnValue(supabase);
    expect(await getRepairCenterAddress(merchantId)).toBeNull();
  });

  it('maps a complete projection into a receiver address', async () => {
    const supabase = makeClient({ data: completeProjection, error: null });
    mocks.createRepairPickupReceiverClient.mockReturnValue(supabase);

    const result = await getRepairCenterAddress(merchantId);

    expect(result).toEqual({
      name: 'Ogabassey Repair Center',
      phone: '09070007000',
      email: 'repairs@ogabassey.com',
      address: '3 Olayeni Street, Computer Village',
      city: 'Ikeja',
      state: 'Lagos',
      country: 'Nigeria',
      countryCode: 'NG',
    });
    expect(mocks.createRepairPickupReceiverClient).toHaveBeenCalledWith(
      merchantId,
      expect.any(Date),
      'server-quote'
    );
  });

  it('binds paid fulfillment to the fulfillment receiver context', async () => {
    const supabase = makeClient({ data: completeProjection, error: null });
    mocks.createRepairPickupReceiverClient.mockReturnValue(supabase);

    await getRepairCenterAddress(merchantId, 'server-fulfillment');

    expect(mocks.createRepairPickupReceiverClient).toHaveBeenCalledWith(
      merchantId,
      expect.any(Date),
      'server-fulfillment'
    );
  });

  it('returns null and logs when the query errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeClient({
      data: null,
      error: { message: 'boom' },
    });
    mocks.createRepairPickupReceiverClient.mockReturnValue(supabase);
    try {
      await expect(getRepairCenterAddress(merchantId)).rejects.toBeInstanceOf(
        RepairCenterLookupError
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'getRepairCenterAddress: query failed',
        { message: 'boom' }
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
