import { describe, expect, it, vi } from 'vitest';
import type { MerchantData, StaffAccess } from './types';
import { createMerchantUpdate } from './update-merchant-data';

const ownerAccess: StaffAccess = {
  isStaff: false,
  isOwner: true,
  role: null,
  permissions: {},
};

const merchant = {
  id: 'merchant-b',
  user_id: 'owner-1',
  business_name: 'Baci B',
  business_type: 'fashion',
} satisfies MerchantData;

function createSupabaseStub() {
  const query = { error: null, eq: vi.fn() };
  query.eq.mockReturnValue(query);
  const update = vi.fn().mockReturnValue(query);
  const from = vi.fn().mockReturnValue({ update });

  return {
    client: {
      from,
    } as unknown as Awaited<ReturnType<Parameters<typeof createMerchantUpdate>[0]['getSupabase']>>,
    from,
    update,
    eq: query.eq,
  };
}

describe('createMerchantUpdate', () => {
  it('writes a captured merchant target and only optimistically updates that active merchant', async () => {
    // Arrange — the selected merchant was captured before an async workflow.
    const supabase = createSupabaseStub();
    const setMerchant = vi.fn();
    const reloadMerchant = vi.fn();
    const updateMerchant = createMerchantUpdate({
      getSupabase: async () => supabase.client,
      userId: 'owner-1',
      staffAccess: ownerAccess,
      activeMerchantId: merchant.id,
      setMerchant,
      reloadMerchant,
    });

    // Act
    await updateMerchant(
      { template_id: 'modern' },
      { merchantId: 'merchant-a', skipReload: true }
    );

    // Assert — owner writes remain scoped to both the captured merchant and owner.
    expect(supabase.from).toHaveBeenCalledWith('merchants');
    expect(supabase.update).toHaveBeenCalledWith({ template_id: 'modern' });
    expect(supabase.eq).toHaveBeenNthCalledWith(1, 'id', 'merchant-a');
    expect(supabase.eq).toHaveBeenNthCalledWith(2, 'user_id', 'owner-1');
    expect(setMerchant).toHaveBeenCalledWith(expect.any(Function));
    expect(reloadMerchant).not.toHaveBeenCalled();

    const optimisticUpdater = setMerchant.mock.calls[0][0] as (
      current: MerchantData | null
    ) => MerchantData | null;
    expect(optimisticUpdater(merchant)).toBe(merchant);
  });

  it('rejects generic writes without an active or captured merchant target', async () => {
    // Arrange
    const supabase = createSupabaseStub();
    const updateMerchant = createMerchantUpdate({
      getSupabase: async () => supabase.client,
      userId: 'owner-1',
      staffAccess: ownerAccess,
      activeMerchantId: null,
      setMerchant: vi.fn(),
      reloadMerchant: vi.fn(),
    });

    // Act & Assert
    await expect(updateMerchant({ template_id: 'modern' })).rejects.toThrow(
      'Cannot update merchant data without a selected merchant.'
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('updates a selected merchant without reloading the implicit dashboard merchant', async () => {
    // Arrange — the dashboard context displays selected merchant B, while its
    // no-argument reload boundary resolves the signed-in owner's merchant A.
    const supabase = createSupabaseStub();
    const setMerchant = vi.fn();
    const reloadMerchant = vi.fn();
    const updateMerchant = createMerchantUpdate({
      getSupabase: async () => supabase.client,
      userId: 'owner-1',
      staffAccess: ownerAccess,
      activeMerchantId: merchant.id,
      setMerchant,
      reloadMerchant,
    });

    // Act
    await updateMerchant(
      { business_name: 'Updated Baci B' },
      { merchantId: merchant.id }
    );

    // Assert — keep the update inside B's context instead of allowing the
    // implicit reload to replace it with A.
    expect(reloadMerchant).not.toHaveBeenCalled();
    expect(setMerchant).toHaveBeenCalledWith(expect.any(Function));

    const selectedMerchantUpdater = setMerchant.mock.calls[0][0] as (
      current: MerchantData | null
    ) => MerchantData | null;
    expect(selectedMerchantUpdater(merchant)).toEqual({
      ...merchant,
      business_name: 'Updated Baci B',
    });

    const implicitMerchant = { ...merchant, id: 'merchant-a' };
    expect(selectedMerchantUpdater(implicitMerchant)).toBe(implicitMerchant);
  });
});
