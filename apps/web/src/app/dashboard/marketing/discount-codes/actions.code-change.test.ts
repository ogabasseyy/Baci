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

const { upsertDiscountCode } = await import('./actions');

function chainTo(single: ReturnType<typeof vi.fn>) {
  const c: Record<string, unknown> = {
    eq: vi.fn(() => c),
    select: vi.fn(() => c),
    single,
    maybeSingle: single,
  };
  return c;
}

describe('discount code RDM reservation on change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockEnsurePermission.mockResolvedValue({
      merchant: { id: 'merchant-1' },
      staffAccess: { isOwner: true, isStaff: false, role: 'owner' },
    });
  });

  function mockUpdateFlow(currentCode: string | null) {
    const updateSingle = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn((..._args: unknown[]) => chainTo(updateSingle));
    const fetchSingle = vi.fn().mockResolvedValue({
      data: currentCode === null ? null : { code: currentCode },
      error: null,
    });
    mockCreateClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => ({
        select: vi.fn(() => chainTo(fetchSingle)),
        update: updateMock,
      })),
    });
    return { updateMock, updateSingle };
  }

  it('keeps a legacy RDM code editable when unchanged', async () => {
    const { updateMock } = mockUpdateFlow('RDM-LEGACY-01');

    const result = await upsertDiscountCode({
      id: 'dc-1',
      code: 'RDM-LEGACY-01',
      discount_type: 'fixed_amount',
      discount_value: 100,
      is_active: false,
    });

    expect(result).toEqual({ success: true });
    // The unchanged code stays out of the payload so the DB trigger
    // never sees a rewrite of the reserved prefix.
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0]?.[0]).not.toHaveProperty('code');
  });

  it('rejects renaming a code to the reserved prefix', async () => {
    mockUpdateFlow('SAVE30');

    await expect(
      upsertDiscountCode({
        id: 'dc-1',
        code: 'RDM-NEW-01',
        discount_type: 'fixed_amount',
        discount_value: 100,
      })
    ).rejects.toThrow('RDM-');
  });

  it('still sends the code on a genuine rename', async () => {
    const { updateMock } = mockUpdateFlow('SAVE30');

    await upsertDiscountCode({
      id: 'dc-1',
      code: 'SAVE31',
      discount_type: 'percentage',
      discount_value: 10,
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({ code: 'SAVE31' });
  });
});
