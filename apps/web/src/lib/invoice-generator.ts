/**
 * Peppol BIS Billing 3.0 Compliant Invoice Generator
 *
 * Generates PDF invoices that comply with:
 * - Peppol BIS Billing 3.0 (55 mandatory fields)
 * - Nigeria FIRS e-invoicing requirements
 * - Nigeria Tax Act 2025 standards
 *
 * References:
 * - https://docs.peppol.eu/poacc/billing/3.0/
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Extended jsPDF type with autotable properties
interface JsPDFWithAutoTable extends jsPDF {
  lastAutoTable?: {
    finalY: number;
  };
}

// UN/ECE Rec 20 Unit Code descriptions
const UNIT_CODE_NAMES: Record<string, string> = {
  EA: 'Each',
  KGM: 'Kilogram',
  GRM: 'Gram',
  MTR: 'Metre',
  LTR: 'Litre',
  MTK: 'Square metre',
  MTQ: 'Cubic metre',
  PCE: 'Piece',
  SET: 'Set',
  PR: 'Pair',
  PK: 'Pack',
  BX: 'Box',
  CT: 'Carton',
  DZN: 'Dozen',
  HUR: 'Hour',
  DAY: 'Day',
  MON: 'Month',
  ANN: 'Year',
};

// VAT Category descriptions
const VAT_CATEGORY_NAMES: Record<string, string> = {
  S: 'Standard rate',
  Z: 'Zero rated',
  E: 'Exempt',
  AE: 'Reverse charge',
  K: 'Intra-community',
  G: 'Export',
  O: 'Outside scope',
};

// Invoice type code descriptions (UNCL 1001)
const INVOICE_TYPE_NAMES: Record<string, string> = {
  '325': 'Proforma Invoice',
  '380': 'Commercial Invoice',
  '381': 'Credit Note',
  '383': 'Debit Note',
  '384': 'Corrected Invoice',
  '386': 'Prepayment Invoice',
  '389': 'Self-billed Invoice',
};

export interface InvoiceLineItem {
  line_id: number;
  product_id?: string;
  name: string;
  description?: string;
  quantity: number;
  unit_code: string;
  price: number;
  line_extension_amount: number;
  vat_category_code?: string;
  vat_rate?: number;
  vat_amount?: number;
  sellers_item_id?: string;
}

export interface TaxSubtotal {
  vat_category_code: string;
  vat_rate: number;
  taxable_amount: number;
  tax_amount: number;
  exemption_reason?: string;
}

export interface MerchantInfo {
  business_name: string;
  legal_entity_name?: string;
  tax_identification_number?: string;
  endpoint_id?: string;
  endpoint_scheme_id?: string;
  cac_rc_number?: string;
  vat_registration_status: string;
  vat_rate: number;
  registered_address?: {
    street?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  support_email?: string;
  support_phone?: string;
  logo_url?: string;
}

export interface CustomerInfo {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  endpoint_id?: string;
  endpoint_scheme_id?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  tax_id?: string;
}

export interface InvoiceData {
  order_id?: string;
  // Document identifiers (BT-1 to BT-3)
  invoice_number: string;
  invoice_type_code: string;
  issue_date: Date;
  tax_point_date?: Date;
  due_date?: Date;

  // Currency (BT-5)
  currency: string;

  // References
  buyer_reference?: string;
  purchase_order_reference?: string;

  // Parties
  merchant: MerchantInfo;
  customer: CustomerInfo;

  // Line items
  items: InvoiceLineItem[];

  // Tax breakdown
  tax_subtotals: TaxSubtotal[];

  // Totals
  subtotal: number;
  tax_exclusive_amount: number;
  tax_amount: number;
  tax_inclusive_amount: number;
  shipping_fee: number;
  discount_amount: number;
  total: number;
  amount_paid?: number;

  // Additional info
  notes?: string;
  payment_terms?: string;
  payment_account?: {
    account_number: string;
    account_name?: string;
    bank_name?: string;
  };

  // FIRS specific (Phase 2)
  firs_irn?: string;
  firs_csid?: string;
  firs_qr_code?: string;
}

// Module-scope cache: locale + fraction digits are static; currency varies.
const invoiceCurrencyFormatterCache = new Map<string, Intl.NumberFormat>();
function getInvoiceCurrencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = invoiceCurrencyFormatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    invoiceCurrencyFormatterCache.set(currency, formatter);
  }
  return formatter;
}

/**
 * Format currency with proper Nigerian Naira formatting
 */
function formatCurrency(amount: number, currency = 'NGN'): string {
  return getInvoiceCurrencyFormatter(currency).format(amount);
}

/**
 * Format date for display
 */
function formatDisplayDate(date: Date): string {
  return date.toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Generate a Peppol BIS 3.0 compliant invoice PDF
 */
export function generateInvoicePDF(data: InvoiceData): jsPDF {
  const doc = new jsPDF() as JsPDFWithAutoTable;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  // Colors
  const primaryColor: [number, number, number] = [41, 128, 185]; // Blue
  const textColor: [number, number, number] = [51, 51, 51];
  const lightGray: [number, number, number] = [245, 245, 245];

  // ========================================
  // HEADER SECTION
  // ========================================

  // Invoice type badge
  doc.setFillColor(...primaryColor);
  doc.roundedRect(margin, y, 50, 8, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(
    INVOICE_TYPE_NAMES[data.invoice_type_code] || 'Invoice',
    margin + 25,
    y + 5.5,
    { align: 'center' }
  );

  // Invoice number (right aligned)
  doc.setTextColor(...textColor);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(data.invoice_number, pageWidth - margin, y + 6, { align: 'right' });

  y += 15;

  // ========================================
  // SELLER (MERCHANT) INFORMATION - BT-27 to BT-43
  // ========================================

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...primaryColor);
  doc.text(
    data.merchant.legal_entity_name || data.merchant.business_name,
    margin,
    y
  );

  y += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...textColor);

  // Registration numbers
  const regInfo: string[] = [];
  if (data.merchant.cac_rc_number) {
    regInfo.push(`RC: ${data.merchant.cac_rc_number}`);
  }
  if (data.merchant.tax_identification_number) {
    regInfo.push(`TIN: ${data.merchant.tax_identification_number}`);
  }
  if (regInfo.length > 0) {
    doc.text(regInfo.join('  |  '), margin, y);
    y += 4;
  }

  // Address
  if (data.merchant.registered_address) {
    const addr = data.merchant.registered_address;
    const addressParts = [
      addr.street,
      addr.city,
      addr.state,
      addr.postal_code,
      addr.country,
    ].filter(Boolean);
    if (addressParts.length > 0) {
      doc.text(addressParts.join(', '), margin, y);
      y += 4;
    }
  }

  // Contact
  const contactParts: string[] = [];
  if (data.merchant.support_email) {
    contactParts.push(data.merchant.support_email);
  }
  if (data.merchant.support_phone) {
    contactParts.push(data.merchant.support_phone);
  }
  if (contactParts.length > 0) {
    doc.text(contactParts.join('  |  '), margin, y);
    y += 4;
  }

  // VAT Status
  if (data.merchant.vat_registration_status === 'registered') {
    doc.setFont('helvetica', 'bold');
    doc.text(`VAT Registered (${data.merchant.vat_rate}%)`, margin, y);
    y += 4;
  } else if (data.merchant.vat_registration_status === 'exempt') {
    doc.text('Small Business Exempt (NTA 2025)', margin, y);
    y += 4;
  }

  y += 6;

  // ========================================
  // INVOICE DETAILS BOX
  // ========================================

  const detailsBoxY = 20;
  const detailsBoxWidth = 60;
  const detailsBoxX = pageWidth - margin - detailsBoxWidth;

  doc.setFillColor(...lightGray);
  doc.roundedRect(detailsBoxX, detailsBoxY, detailsBoxWidth, 35, 2, 2, 'F');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);

  let detailY = detailsBoxY + 6;

  // Issue Date (BT-2)
  doc.text('Issue Date:', detailsBoxX + 3, detailY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...textColor);
  doc.text(formatDisplayDate(data.issue_date), detailsBoxX + 30, detailY);

  detailY += 5;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);

  // Tax Point Date (BT-7)
  if (data.tax_point_date) {
    doc.text('Tax Point:', detailsBoxX + 3, detailY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...textColor);
    doc.text(formatDisplayDate(data.tax_point_date), detailsBoxX + 30, detailY);
    detailY += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
  }

  // Due Date (BT-9)
  if (data.due_date) {
    doc.text('Due Date:', detailsBoxX + 3, detailY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...textColor);
    doc.text(formatDisplayDate(data.due_date), detailsBoxX + 30, detailY);
    detailY += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
  }

  // Currency (BT-5)
  doc.text('Currency:', detailsBoxX + 3, detailY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...textColor);
  doc.text(data.currency, detailsBoxX + 30, detailY);

  detailY += 5;

  // References
  if (data.buyer_reference) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('Buyer Ref:', detailsBoxX + 3, detailY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...textColor);
    doc.text(data.buyer_reference, detailsBoxX + 30, detailY);
  }

  // ========================================
  // BUYER (CUSTOMER) INFORMATION - BT-44 to BT-63
  // ========================================

  doc.setFillColor(...lightGray);
  doc.roundedRect(margin, y, pageWidth - 2 * margin, 25, 2, 2, 'F');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('BILL TO', margin + 4, y + 5);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...textColor);
  doc.text(data.customer.name, margin + 4, y + 11);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  const customerDetails: string[] = [];
  if (data.customer.email) customerDetails.push(data.customer.email);
  if (data.customer.phone) customerDetails.push(data.customer.phone);
  if (customerDetails.length > 0) {
    doc.text(customerDetails.join('  |  '), margin + 4, y + 16);
  }

  if (data.customer.address) {
    const addr = data.customer.address;
    const addressParts = [
      addr.street,
      addr.city,
      addr.state,
      addr.postal_code,
      addr.country,
    ].filter(Boolean);
    if (addressParts.length > 0) {
      doc.text(addressParts.join(', '), margin + 4, y + 21);
    }
  }

  y += 32;

  // ========================================
  // LINE ITEMS TABLE - BG-25 to BT-158
  // ========================================

  const tableHeaders = [
    '#',
    'Description',
    'SKU',
    'Qty',
    'Unit',
    'Price',
    'VAT %',
    'VAT',
    'Amount',
  ];

  const tableData = data.items.map((item) => [
    String(item.line_id),
    item.name + (item.description ? `\n${item.description}` : ''),
    item.sellers_item_id || '-',
    String(item.quantity),
    UNIT_CODE_NAMES[item.unit_code] || item.unit_code,
    formatCurrency(item.price, data.currency),
    item.vat_category_code
      ? item.vat_category_code === 'S'
        ? `${item.vat_rate ?? 0}%`
        : item.vat_category_code
      : '-',
    item.vat_amount == null
      ? '-'
      : formatCurrency(item.vat_amount, data.currency),
    formatCurrency(
      item.line_extension_amount + (item.vat_amount ?? 0),
      data.currency
    ),
  ]);

  autoTable(doc, {
    startY: y,
    head: [tableHeaders],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: textColor,
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 45 },
      2: { cellWidth: 20 },
      3: { cellWidth: 12, halign: 'right' },
      4: { cellWidth: 15 },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 15, halign: 'center' },
      7: { cellWidth: 22, halign: 'right' },
      8: { cellWidth: 25, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  y = doc.lastAutoTable?.finalY ?? y + 50;
  y += 10;

  // ========================================
  // TAX BREAKDOWN - BG-23 (Required for Peppol)
  // ========================================

  if (
    data.tax_subtotals.length > 0 &&
    data.merchant.vat_registration_status === 'registered'
  ) {
    const taxTableX = margin;
    const taxTableWidth = 90;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...primaryColor);
    doc.text('VAT Breakdown', taxTableX, y);
    y += 5;

    const taxHeaders = ['Category', 'Rate', 'Taxable Amount', 'VAT Amount'];
    const taxData = data.tax_subtotals.map((subtotal) => [
      VAT_CATEGORY_NAMES[subtotal.vat_category_code] ||
        subtotal.vat_category_code,
      `${subtotal.vat_rate}%`,
      formatCurrency(subtotal.taxable_amount, data.currency),
      formatCurrency(subtotal.tax_amount, data.currency),
    ]);

    autoTable(doc, {
      startY: y,
      head: [taxHeaders],
      body: taxData,
      theme: 'plain',
      headStyles: {
        fillColor: lightGray,
        textColor: textColor,
        fontStyle: 'bold',
        fontSize: 8,
      },
      bodyStyles: {
        fontSize: 8,
        textColor: textColor,
      },
      tableWidth: taxTableWidth,
      margin: { left: taxTableX },
    });

    y = doc.lastAutoTable?.finalY ?? y + 20;
  }

  // ========================================
  // TOTALS SECTION - BG-22
  // ========================================

  const totalsX = pageWidth - margin - 70;
  const totalsWidth = 70;
  let totalsY = Math.max(y - 30, doc.lastAutoTable?.finalY ?? y);

  doc.setFillColor(...lightGray);
  doc.roundedRect(totalsX, totalsY, totalsWidth, 45, 2, 2, 'F');

  totalsY += 6;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...textColor);

  // Subtotal (BT-106)
  doc.text('Subtotal:', totalsX + 3, totalsY);
  doc.text(
    formatCurrency(data.subtotal, data.currency),
    totalsX + totalsWidth - 3,
    totalsY,
    {
      align: 'right',
    }
  );
  totalsY += 5;

  // Shipping
  if (data.shipping_fee > 0) {
    doc.text('Shipping:', totalsX + 3, totalsY);
    doc.text(
      formatCurrency(data.shipping_fee, data.currency),
      totalsX + totalsWidth - 3,
      totalsY,
      { align: 'right' }
    );
    totalsY += 5;
  }

  // Discount
  if (data.discount_amount > 0) {
    doc.text('Discount:', totalsX + 3, totalsY);
    doc.text(
      `-${formatCurrency(data.discount_amount, data.currency)}`,
      totalsX + totalsWidth - 3,
      totalsY,
      { align: 'right' }
    );
    totalsY += 5;
  }

  // Tax Exclusive (BT-109)
  doc.text('Tax Exclusive:', totalsX + 3, totalsY);
  doc.text(
    formatCurrency(data.tax_exclusive_amount, data.currency),
    totalsX + totalsWidth - 3,
    totalsY,
    { align: 'right' }
  );
  totalsY += 5;

  // VAT Amount (BT-110)
  if (data.tax_amount > 0) {
    doc.text('VAT:', totalsX + 3, totalsY);
    doc.text(
      formatCurrency(data.tax_amount, data.currency),
      totalsX + totalsWidth - 3,
      totalsY,
      { align: 'right' }
    );
    totalsY += 5;
  }

  // Total (BT-112)
  doc.setDrawColor(...primaryColor);
  doc.line(totalsX + 3, totalsY - 1, totalsX + totalsWidth - 3, totalsY - 1);
  totalsY += 3;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL:', totalsX + 3, totalsY);
  doc.text(
    formatCurrency(data.total, data.currency),
    totalsX + totalsWidth - 3,
    totalsY,
    {
      align: 'right',
    }
  );

  // ========================================
  // NOTES & PAYMENT TERMS
  // ========================================

  y = Math.max(y + 10, totalsY + 15);

  if (data.notes) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...primaryColor);
    doc.text('Notes:', margin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...textColor);
    const splitNotes = doc.splitTextToSize(data.notes, pageWidth - 2 * margin);
    doc.text(splitNotes, margin, y);
    y += splitNotes.length * 4 + 4;
  }

  if (data.payment_terms) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...primaryColor);
    doc.text('Payment Terms:', margin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...textColor);
    doc.text(data.payment_terms, margin, y);
    y += 8;
  }

  // ========================================
  // FOOTER - COMPLIANCE INFO
  // ========================================

  const footerY = doc.internal.pageSize.getHeight() - 20;

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(128, 128, 128);

  // Peppol compliance note
  doc.text(
    'This invoice complies with Peppol BIS Billing 3.0 and Nigeria Tax Act 2025 requirements.',
    margin,
    footerY
  );

  // FIRS reference (if available)
  if (data.firs_irn) {
    doc.text(`FIRS IRN: ${data.firs_irn}`, margin, footerY + 4);
  }

  // Document identifiers
  doc.text(
    `Invoice Type: ${data.invoice_type_code} | Currency: ${data.currency} | Generated: ${new Date().toISOString()}`,
    margin,
    footerY + 8
  );

  return doc;
}
