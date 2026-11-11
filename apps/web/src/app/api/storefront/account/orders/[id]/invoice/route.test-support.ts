import type { SupabaseClient, User } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { AuthResult } from '@/lib/api-auth';

const { mockGeneratePeppolInvoiceXml, mockResolveReceiptLogoDataUri } =
  vi.hoisted(() => ({
    mockGeneratePeppolInvoiceXml: vi.fn(() => '<Invoice />'),
    mockResolveReceiptLogoDataUri: vi.fn(
      (): Promise<string | null> => Promise.resolve(null)
    ),
  }));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
}));

vi.mock('@/lib/receipt-pdf-generator', () => ({
  generateReceiptBlob: vi.fn(),
  resolveReceiptLogoDataUri: mockResolveReceiptLogoDataUri,
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/peppol-ubl-invoice', () => ({
  generatePeppolInvoiceXml: mockGeneratePeppolInvoiceXml,
  PEPPOL_BIS_BILLING_COMPLIANCE_NOTE:
    'This invoice complies with Peppol BIS Billing 3.0 through a generated UBL XML invoice artifact created from this order.',
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
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
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limiter';
import { generateReceiptBlob } from '@/lib/receipt-pdf-generator';
import {
  getStorefrontAccountDocumentData,
  StorefrontAccountDocumentError,
} from '@/lib/storefront-account-document-data';
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

function createDocumentData(
  orderNumber: string
): StorefrontAccountDocumentData {
  return {
    order: {
      id: 'order-1',
      order_number: orderNumber,
      created_at: '2026-03-22T10:00:00.000Z',
      total: 100000,
      payment_status: 'paid',
      shipping_status: 'processing',
      items: [],
      receipt_eligible: false,
      current_document_kind: 'invoice',
    },
    invoiceData: {
      invoice_number: orderNumber,
      invoice_type_code: '380',
      buyer_reference: 'BUYER-REF-001',
      issue_date: new Date('2026-04-01T00:00:00.000Z'),
      due_date: new Date('2026-04-15T00:00:00.000Z'),
      payment_terms: 'Net 14',
      firs_irn: 'IRN-2026-001',
      firs_csid: 'CSID-2026-001',
      notes: 'Invoice note',
      items: [
        {
          line_id: 1,
          product_id: 'product-1',
          name: 'iPhone 15 Pro',
          description: 'IMEI: 123456789012345',
          quantity: 1,
          unit_code: 'EA',
          price: 100000,
          line_extension_amount: 100000,
          sellers_item_id: 'SELLER-IPHONE-15',
          vat_amount: 7500,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
      tax_subtotals: [
        {
          taxable_amount: 100000,
          tax_amount: 7500,
          vat_category_code: 'S',
          vat_rate: 7.5,
        },
      ],
    } as StorefrontAccountDocumentData['invoiceData'],
    receiptOrder: {
      items: [
        {
          line_id: 1,
          product_id: 'product-1',
          product_name: 'iPhone 15 Pro',
          quantity: 1,
          price: 100000,
        },
      ],
    } as StorefrontAccountDocumentData['receiptOrder'],
    receiptMerchant: {
      registered_address: {
        street: '99 Registered Road',
      },
    } as StorefrontAccountDocumentData['receiptMerchant'],
    receiptCompletionDate: null,
  } as StorefrontAccountDocumentData;
}

export const invoiceTestSupport = {
  mockGeneratePeppolInvoiceXml,
  mockResolveReceiptLogoDataUri,
  authenticateApiRequest,
  logger,
  checkRateLimit,
  generateReceiptBlob,
  getStorefrontAccountDocumentData,
  StorefrontAccountDocumentError,
  GET,
  createAuthenticatedAuthResult,
  createDocumentData,
};
