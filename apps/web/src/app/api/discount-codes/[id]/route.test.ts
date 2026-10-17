import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkCsrfProtection, hasPermission, getMerchantForApiRequest } =
  vi.hoisted(() => ({
    checkCsrfProtection: vi.fn(),
    hasPermission: vi.fn(),
    getMerchantForApiRequest: vi.fn(),
  }));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));

vi.mock('@/lib/csrf', () => ({ checkCsrfProtection }));
vi.mock('@/lib/api-auth', () => ({ hasPermission }));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest,
  toUserAccess: vi.fn((context: { role?: string }) => ({
    role: context.role ?? 'owner',
  })),
}));

const CODE_ID = '11111111-1111-4111-8111-111111111111';

let currentRow: { code: string } | null = { code: 'SALE10' };
let currentError: { message: string } | null = null;
let updatedRow: Record<string, unknown> | null = null;
let updateError: { code?: string; message: string } | null = null;
const updateCall = vi.fn();

function selectChain() {
  return {
    eq: () => ({
      eq: () => ({
        maybeSingle: () =>
          Promise.resolve({ data: currentRow, error: currentError }),
        single: () =>
          Promise.resolve({ data: currentRow, error: currentError }),
      }),
    }),
  };
}

function updateChain() {
  return {
    eq: () => ({
      eq: () => ({
        select: () => ({
          single: () =>
            Promise.resolve(
              updateError
                ? { data: null, error: updateError }
                : currentRow === null
                  ? {
                      data: null,
                      error: { code: 'PGRST116', message: 'no rows returned' },
                    }
                  : {
                      data: updatedRow ?? {
                        id: CODE_ID,
                        code: currentRow?.code,
                      },
                      error: null,
                    }
            ),
        }),
      }),
    }),
  };
}

const createMockSupabase = () => ({
  auth: {
    getUser: vi.fn(() =>
      Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })
    ),
  },
  from: vi.fn(() => ({
    select: selectChain,
    update: (...args: unknown[]) => {
      updateCall(...args);
      return updateChain();
    },
  })),
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => createMockSupabase()),
}));

import { PATCH } from './route';

function patchRequest(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest(`http://localhost/api/discount-codes/${CODE_ID}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: CODE_ID }) }
  );
}

describe('PATCH /api/discount-codes/[id] RDM- reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRow = { code: 'SALE10' };
    currentError = null;
    updatedRow = null;
    updateError = null;
    checkCsrfProtection.mockResolvedValue({ valid: true, response: null });
    hasPermission.mockReturnValue(true);
    getMerchantForApiRequest.mockResolvedValue({ merchantId: 'merchant-1' });
  });

  it('rejects renaming into the reserved RDM- prefix with a 400', async () => {
    const response = await patchRequest({ code: 'RDM-NEW' });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe(
      'Code prefix RDM- is reserved for loyalty redemptions'
    );
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('returns 404 instead of the reserved-prefix 400 for a missing row', async () => {
    currentRow = null;

    const response = await patchRequest({ code: 'RDM-NEW' });

    expect(response.status).toBe(404);
    expect(updateCall).toHaveBeenCalled();
  });

  it('maps the DB reserved-prefix guard to the same 400 on a raced rename', async () => {
    currentRow = { code: 'RDM-LEGACY' };
    updateError = {
      message: 'discount code prefix RDM- is reserved for loyalty redemptions',
    };

    const response = await patchRequest({ code: 'rdm-legacy' });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe(
      'Code prefix RDM- is reserved for loyalty redemptions'
    );
  });

  it('allows resubmitting an unchanged legacy RDM- code', async () => {
    currentRow = { code: 'RDM-LEGACY' };

    const response = await patchRequest({ code: 'rdm-legacy' });

    expect(response.status).toBe(200);
    expect(updateCall).toHaveBeenCalled();
  });

  it('allows renaming to a non-reserved code', async () => {
    const response = await patchRequest({ code: 'SALE20' });

    expect(response.status).toBe(200);
    expect(updateCall).toHaveBeenCalled();
  });
});
