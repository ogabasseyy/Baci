import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResult } from '@/lib/api-auth';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
}));

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: vi.fn(),
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/storefront-account-document-data', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/storefront-account-document-data')
  >('@/lib/storefront-account-document-data');

  return {
    ...actual,
    getStorefrontAccountDocumentData: vi.fn(),
  };
});

import { authenticateApiRequest } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { generateReceiptBlob } from '@/lib/receipt-pdf-generator';
import { getStorefrontAccountDocumentData } from '@/lib/storefront-account-document-data';
import { GET } from './route';

type StorefrontAccountDocumentData = Awaited<
  ReturnType<typeof getStorefrontAccountDocumentData>
>;

function createAuthenticatedAuthResult(): AuthResult {
  return {
    user: { id: 'user-1' } as User,
    error: null,
    supabase: {} as SupabaseClient,
  };
}

describe('GET /api/storefront/account/orders/[id]/invoice manual gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
  });

  it('returns 409 for a sender-refused manual order', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue({
      order: {
        is_manual_order: true,
        manual_document_available: false,
      },
    } as StorefrontAccountDocumentData);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'INVOICE_NOT_AVAILABLE',
    });
    expect(generateReceiptBlob).not.toHaveBeenCalled();
  });
});
