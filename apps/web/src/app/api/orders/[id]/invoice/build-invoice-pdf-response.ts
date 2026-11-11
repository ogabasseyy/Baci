import type { ReceiptMerchant, ReceiptOrder } from '@baci/shared';
import { NextResponse } from 'next/server';
import { buildPdfContentDisposition } from '@/lib/download-filename';
import type { InvoiceData } from '@/lib/invoice-generator';
import {
  generatePeppolInvoiceXml,
  PEPPOL_BIS_BILLING_COMPLIANCE_NOTE,
} from '@/lib/peppol-ubl-invoice';
import {
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
} from '@/lib/receipt-pdf-generator';

export async function buildInvoicePdfResponse(
  orderId: string,
  invoiceData: InvoiceData,
  receiptOrder: ReceiptOrder,
  receiptMerchant: ReceiptMerchant
) {
  let complianceNote: string | undefined;
  // Peppol UBL is a commercial-invoice artifact: proforma (325)
  // documents skip the XML call and carry no compliance note.
  if (invoiceData.invoice_type_code !== '325') {
    try {
      generatePeppolInvoiceXml(invoiceData);
      complianceNote = PEPPOL_BIS_BILLING_COMPLIANCE_NOTE;
    } catch (peppolError) {
      console.error('Failed to generate Peppol UBL invoice XML:', peppolError);
    }
  }

  // Generate the branded PDF
  let logoDataUri: string | null = null;
  try {
    logoDataUri = await resolveReceiptLogoDataUri(receiptMerchant);
  } catch (logoError) {
    console.warn(
      'Failed to resolve invoice logo; using fallback PDF branding',
      {
        orderId,
        error: logoError,
      }
    );
  }

  const pdfBlob = await generateReceiptBlob(receiptOrder, receiptMerchant, {
    buyerReference: invoiceData.buyer_reference,
    complianceNote,
    documentDate: invoiceData.issue_date,
    documentKind:
      invoiceData.invoice_type_code === '325' ? 'proforma_invoice' : 'invoice',
    dueDate: invoiceData.due_date,
    firsCsid: invoiceData.firs_csid,
    firsIrn: invoiceData.firs_irn,
    invoiceTypeCode: invoiceData.invoice_type_code,
    invoiceNotes: invoiceData.notes,
    logoDataUri,
    paymentTerms: invoiceData.payment_terms,
    taxSubtotals: invoiceData.tax_subtotals,
  });

  // Return the PDF as a response
  const pdfArrayBuffer = await pdfBlob.arrayBuffer();

  return new NextResponse(pdfArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': buildPdfContentDisposition(
        invoiceData.invoice_type_code === '325' ? 'proforma' : 'invoice',
        invoiceData.invoice_number
      ),
      'Cache-Control': 'private, no-store',
    },
  });
}
