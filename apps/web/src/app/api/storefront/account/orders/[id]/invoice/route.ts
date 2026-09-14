import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { buildPdfContentDisposition } from '@/lib/download-filename';
import { mergeReceiptItemsWithInvoiceMetadata } from '@/lib/invoice-receipt-item-metadata';
import { logger } from '@/lib/logger';
import { generatePeppolInvoiceXml } from '@/lib/peppol-ubl-invoice';
import { checkRateLimit } from '@/lib/rate-limiter';
import {
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';
import {
  getStorefrontAccountDocumentData,
  StorefrontAccountDocumentError,
} from '@/lib/storefront-account-document-data';
import {
  storefrontAccountDocumentParamsSchema,
  storefrontAccountDocumentQuerySchema,
} from '@/schemas/storefront-account-document';

const RATE_LIMIT_WINDOW_MINUTES = 1;
const RETRY_AFTER_SECONDS = String(RATE_LIMIT_WINDOW_MINUTES * 60);

function toErrorResponse(error: unknown) {
  if (error instanceof StorefrontAccountDocumentError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }

  console.error('Unexpected storefront invoice download error:', error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);

  if (!auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsedParams = storefrontAccountDocumentParamsSchema.safeParse(
    await params
  );
  const merchantSlug = new URL(request.url).searchParams.get('merchantSlug');
  const parsedQuery = storefrontAccountDocumentQuerySchema.safeParse({
    merchantSlug,
  });

  if (!parsedParams.success || !parsedQuery.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const isAllowed = await checkRateLimit(
    auth.supabase,
    auth.user.id,
    'storefront_account_invoice_download',
    10,
    RATE_LIMIT_WINDOW_MINUTES
  );

  if (!isAllowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: { 'Retry-After': RETRY_AFTER_SECONDS } }
    );
  }

  try {
    const data = await getStorefrontAccountDocumentData({
      supabase: auth.supabase,
      userId: auth.user.id,
      merchantSlug: parsedQuery.data.merchantSlug,
      orderId: parsedParams.data.id,
    });
    try {
      generatePeppolInvoiceXml(data.invoiceData);
    } catch (error) {
      logger.warn({
        message: 'Generated branded invoice PDF without Peppol UBL validation',
        orderId: parsedParams.data.id,
        error,
      });
    }

    let logoDataUri: string | null = null;
    try {
      logoDataUri = await resolveReceiptLogoDataUri(data.receiptMerchant);
    } catch (logoError) {
      logger.warn({
        message:
          'Failed to resolve storefront invoice logo; using fallback PDF branding',
        orderId: parsedParams.data.id,
        error: logoError,
      });
    }

    const receiptOrder = {
      ...data.receiptOrder,
      items: mergeReceiptItemsWithInvoiceMetadata(
        data.receiptOrder.items,
        data.invoiceData.items
      ),
    };
    const blob = generateReceiptBlob(receiptOrder, data.receiptMerchant, {
      buyerReference: data.invoiceData.buyer_reference,
      documentDate: data.invoiceData.issue_date,
      documentKind:
        data.invoiceData.invoice_type_code === '325'
          ? 'proforma_invoice'
          : 'invoice',
      dueDate: data.invoiceData.due_date,
      firsCsid: data.invoiceData.firs_csid,
      firsIrn: data.invoiceData.firs_irn,
      invoiceTypeCode: data.invoiceData.invoice_type_code,
      invoiceNotes: data.invoiceData.notes,
      logoDataUri,
      paymentTerms: data.invoiceData.payment_terms,
      taxSubtotals: data.invoiceData.tax_subtotals,
    });

    return new NextResponse(blob, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': buildPdfContentDisposition(
          'invoice',
          data.order.order_number
        ),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
