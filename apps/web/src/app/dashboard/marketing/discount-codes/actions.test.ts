import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnsurePermission = vi.fn();
const mockCreateClient = vi.fn();
const mockGetUser = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/merchant-server', () => ({
  ensurePermission: (...args: unknown[]) => mockEnsurePermission(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const { getDiscountCodes, upsertDiscountCode, deleteDiscountCode } =
  await import('./actions');

describe('discount code actions staff access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
  });

  it('loads discount codes using merchant from permission context', async () => {
    const orderMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'dc-1',
          code: 'SAVE10',
          description: 'Test',
          discount_type: 'percentage',
          discount_value: 10,
          minimum_purchase_amount: 0,
          maximum_discount_amount: null,
          usage_limit: null,
          usage_count: 0,
          usage_limit_per_customer: 1,
          starts_at: null,
          expires_at: null,
          is_active: true,
          applies_to: 'all',
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    });
    const eqMock = vi.fn().mockReturnValue({ order: orderMock });

    mockCreateClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: eqMock })),
      })),
    });

    mockEnsurePermission.mockResolvedValue({
      merchant: { id: 'merchant-staff', country: 'NG' },
      staffAccess: { isOwner: false, isStaff: true, role: 'marketing' },
    });

    const result = await getDiscountCodes();

    expect(mockEnsurePermission).toHaveBeenCalledWith('marketing', 'view');
    expect(eqMock).toHaveBeenCalledWith('merchant_id', 'merchant-staff');
    expect(result.discountCodes).toHaveLength(1);
  });

  it('uses marketing create permission for new codes', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });

    mockCreateClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        insert: insertMock,
      })),
    });

    mockEnsurePermission.mockResolvedValue({
      merchant: { id: 'merchant-staff' },
      staffAccess: { isOwner: false, isStaff: true, role: 'marketing' },
    });

    await upsertDiscountCode({
      code: 'save20',
      discount_type: 'percentage',
      discount_value: 20,
    });

    expect(mockEnsurePermission).toHaveBeenCalledWith('marketing', 'create');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SAVE20',
        merchant_id: 'merchant-staff',
      })
    );
  });

  it('rejects the reserved loyalty prefix', async () => {
    mockEnsurePermission.mockResolvedValue({
      merchant: { id: 'merchant-staff' },
      staffAccess: { isOwner: false, isStaff: true, role: 'marketing' },
    });

    await expect(
      upsertDiscountCode({
        code: 'rdm-abcdef12',
        discount_type: 'percentage',
        discount_value: 20,
      })
    ).rejects.toThrow('RDM-');
  });

  it('uses marketing edit permission for updates', async () => {
    const singleMock = vi.fn().mockResolvedValue({ error: null });
    const selectMock = vi.fn().mockReturnValue({ single: singleMock });
    const eqMerchantMock = vi.fn().mockReturnValue({ select: selectMock });
    const eqIdMock = vi.fn().mockReturnValue({ eq: eqMerchantMock });

    mockCreateClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        update: vi.fn(() => ({ eq: eqIdMock })),
      })),
    });

    mockEnsurePermission.mockResolvedValue({
      merchant: { id: 'merchant-staff' },
      staffAccess: { isOwner: false, isStaff: true, role: 'marketing' },
    });

    await upsertDiscountCode({
      id: 'dc-1',
      code: 'save30',
      discount_type: 'percentage',
      discount_value: 30,
    });

    expect(mockEnsurePermission).toHaveBeenCalledWith('marketing', 'edit');
    expect(eqMerchantMock).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-staff'
    );
  });

  it('uses marketing delete permission for deletion', async () => {
    const singleMock = vi.fn().mockResolvedValue({ error: null });
    const selectMock = vi.fn().mockReturnValue({ single: singleMock });
    const eqMerchantMock = vi.fn().mockReturnValue({ select: selectMock });
    const eqIdMock = vi.fn().mockReturnValue({ eq: eqMerchantMock });

    mockCreateClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        delete: vi.fn(() => ({ eq: eqIdMock })),
      })),
    });

    mockEnsurePermission.mockResolvedValue({
      merchant: { id: 'merchant-staff' },
      staffAccess: { isOwner: false, isStaff: true, role: 'marketing' },
    });

    await deleteDiscountCode('dc-1');

    expect(mockEnsurePermission).toHaveBeenCalledWith('marketing', 'delete');
    expect(eqMerchantMock).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-staff'
    );
  });

  it('rejects unauthenticated callers before resolving marketing permissions', async () => {
    mockCreateClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    await expect(getDiscountCodes()).rejects.toThrow('Unauthorized');

    expect(mockEnsurePermission).not.toHaveBeenCalled();
  });
});

function chainTo(single: ReturnType<typeof vi.fn>) {
  const c: Record<string, unknown> = {
    eq: vi.fn(() => c),
    select: vi.fn(() => c),
    single,
  };
  return c;
}

describe('preserve used discount codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockEnsurePermission.mockResolvedValue({
      merchant: { id: 'merchant-1', country: 'NG' },
      staffAccess: { isOwner: true, isStaff: false, role: 'owner' },
    });
  });

  it('deactivates a used code instead of hard-deleting it', async () => {
    const deleteSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'discount_code_delete_not_allowed' },
    });
    const updateSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: 'dc-1' }, error: null });

    mockCreateClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        delete: vi.fn(() => chainTo(deleteSingle)),
        update: vi.fn(() => chainTo(updateSingle)),
      })),
    });

    const result = await deleteDiscountCode('dc-1');

    expect(result).toEqual({ success: true, deactivated: true });
    expect(updateSingle).toHaveBeenCalled();
  });

  it('rejects renaming a used code with a clear message', async () => {
    const updateSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'discount_code_rename_not_allowed' },
    });

    mockCreateClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        update: vi.fn(() => chainTo(updateSingle)),
      })),
    });

    await expect(
      upsertDiscountCode({
        id: 'dc-1',
        code: 'NEWNAME',
        discount_type: 'percentage',
        discount_value: 10,
      })
    ).rejects.toThrow('cannot be renamed');
  });
});
