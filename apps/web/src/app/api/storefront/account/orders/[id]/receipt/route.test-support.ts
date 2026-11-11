import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, vi } from 'vitest';
import type { AuthResult } from '@/lib/api-auth';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: vi.fn(),
  resolveReceiptLogoDataUri: vi
    .fn()
    .mockResolvedValue('data:image/png;base64,AQID'),
}));

vi.mock(
  import('@/lib/storefront-account-document-data'),
  async (importOriginal) => ({
    ...(await importOriginal()),
    getStorefrontAccountDocumentData: vi.fn(),
  })
);

import { authenticateApiRequest } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import {
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';
import {
  getStorefrontAccountDocumentData,
  StorefrontAccountDocumentError,
} from '@/lib/storefront-account-document-data';
import { GET } from './route';

type StorefrontAccountDocumentData = Awaited<
  ReturnType<typeof getStorefrontAccountDocumentData>
>;
const ORDER_ID = 'cfa945fc-9bf4-4485-857c-4d4374adf31f';
const MERCHANT_SLUG = 'ogabassey';

export function createAuthenticatedAuthResult(): AuthResult {
  return {
    user: { id: 'user-1' } as User,
    error: null,
    supabase: {} as SupabaseClient,
  };
}

export function createDocumentData(
  overrides: Partial<StorefrontAccountDocumentData['order']>
): StorefrontAccountDocumentData {
  const order = {
    id: 'order-1',
    order_number: 'ORD-1001',
    created_at: '2026-03-22T10:00:00.000Z',
    total: 100000,
    payment_status: 'paid',
    shipping_status: 'shipped',
    items: [],
    receipt_eligible: true,
    current_document_kind: 'receipt',
    ...overrides,
  };

  return {
    order,
    invoiceData: {} as StorefrontAccountDocumentData['invoiceData'],
    receiptOrder: {
      order_number: order.order_number,
    } as StorefrontAccountDocumentData['receiptOrder'],
    receiptMerchant: {} as StorefrontAccountDocumentData['receiptMerchant'],
    receiptCompletionDate: '2026-04-02T10:00:00.000Z',
  } as StorefrontAccountDocumentData;
}

function createRequest(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

export function requestReceipt(input?: {
  id?: string;
  merchantSlug?: string | null;
}) {
  const id = input?.id ?? ORDER_ID;
  const merchantSlug =
    input && 'merchantSlug' in input ? input.merchantSlug : MERCHANT_SLUG;
  const query = merchantSlug ? `?merchantSlug=${merchantSlug}` : '';

  return GET(
    createRequest(`/api/storefront/account/orders/${id}/receipt${query}`),
    {
      params: Promise.resolve({ id }),
    }
  );
}

export const receiptRouteMocks = {
  resolveReceiptLogoDataUri,
  authenticateApiRequest,
  checkRateLimit,
  generateReceiptBlob,
  getStorefrontAccountDocumentData,
  StorefrontAccountDocumentError,
};

export function setupReceiptRouteTests() {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(resolveReceiptLogoDataUri).mockResolvedValue(
      'data:image/png;base64,AQID'
    );
  });
}
