import {
  formatOrderItemDisplayName,
  type ReceiptMerchant,
  type ReceiptOrder,
} from '@baci/shared';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import {
  formatReceiptCurrency,
  formatReceiptDate,
} from '@/lib/receipt-pdf-formatters';

const MAX_LOGO_BYTES = 256 * 1024;
const MAX_LOGO_DATA_URI_LENGTH = MAX_LOGO_BYTES * 2;
const LOGO_FETCH_TIMEOUT_MS = 5000;
const SUPABASE_HOST_SUFFIX = '.supabase.co';
const SUPABASE_PUBLIC_LOGO_PREFIXES = [
  '/storage/v1/object/public/media/',
  '/storage/v1/object/public/images/',
];
const MEDIA_CDN_PUBLIC_PREFIX = '/media/';
const TRUSTED_MEDIA_CDN_HOSTNAME = new URL(DEFAULT_MEDIA_CDN_ORIGIN).hostname;

interface JsPDFWithAutoTable extends jsPDF {
  lastAutoTable?: {
    finalY: number;
  };
}

interface GenerateReceiptPdfOptions {
  buyerReference?: string | null;
  complianceNote?: string;
  documentDate?: Date | string | null;
  documentKind?: 'invoice' | 'receipt';
  invoiceTypeCode?: string | null;
  dueDate?: Date | string | null;
  firsCsid?: string | null;
  firsIrn?: string | null;
  invoiceNotes?: string | null;
  logoDataUri?: string | null;
  paymentTerms?: string | null;
  taxSubtotals?: Array<{
    exemption_reason?: string | null;
    taxable_amount: number;
    tax_amount: number;
    vat_category_code: string;
    vat_rate: number;
  }>;
}

function getBrandPrimaryRgb(merchant: ReceiptMerchant) {
  const brandPrimary = merchant.brand_colors?.primary || '#111827';
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(brandPrimary);

  if (!match) {
    return [17, 24, 39] as const;
  }

  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
  ] as const;
}

function getAddressLines(order: ReceiptOrder) {
  const address = order.shipping_address;
  if (!address) return [];

  return [
    address.address_line1,
    address.address_line2,
    [address.city, address.state].filter(Boolean).join(', '),
    [address.postal_code, address.country].filter(Boolean).join(', '),
  ].filter(Boolean) as string[];
}

function writeWrappedTextLines(input: {
  doc: jsPDF;
  lines: Array<string | null | undefined>;
  x: number;
  y: number;
  maxWidth: number;
  lineHeight?: number;
}) {
  const { doc, lines, x, maxWidth, lineHeight = 5 } = input;
  let currentY = input.y;

  lines.filter(Boolean).forEach((line) => {
    const wrappedLines = doc.splitTextToSize(String(line), maxWidth);
    const lineGroup = Array.isArray(wrappedLines)
      ? wrappedLines
      : [wrappedLines];

    lineGroup.forEach((wrappedLine) => {
      doc.text(wrappedLine, x, currentY);
      currentY += lineHeight;
    });
  });

  return currentY;
}

function getReceiptItemVariantName(item: ReceiptOrder['items'][number]) {
  const candidate = item as ReceiptOrder['items'][number] & {
    variant_name?: unknown;
  };

  if (typeof candidate.variant_name !== 'string') {
    return null;
  }

  const variantName = candidate.variant_name.trim();
  return variantName.length > 0 ? variantName : null;
}

function getReceiptItemDescription(item: ReceiptOrder['items'][number]) {
  const candidate = item.description;
  if (typeof candidate !== 'string') {
    return null;
  }

  const description = candidate.trim();
  return description.length > 0 ? description : null;
}

function getReceiptItemLineTotal(item: ReceiptOrder['items'][number]) {
  return typeof item.line_extension_amount === 'number' &&
    Number.isFinite(item.line_extension_amount)
    ? item.line_extension_amount
    : item.quantity * item.price;
}

function getReceiptItemTaxLabel(
  item: ReceiptOrder['items'][number],
  currency: string
) {
  const lines: string[] = [];

  if (typeof item.vat_rate === 'number' && Number.isFinite(item.vat_rate)) {
    lines.push(`VAT: ${item.vat_rate.toFixed(2)}%`);
  }

  if (typeof item.vat_amount === 'number' && Number.isFinite(item.vat_amount)) {
    lines.push(formatReceiptCurrency(item.vat_amount, currency));
  }

  return lines.length > 0 ? lines.join('\n') : '-';
}

function getReceiptItemDetailLines(item: ReceiptOrder['items'][number]) {
  return [
    item.sellers_item_id ? `SKU: ${item.sellers_item_id}` : null,
    item.unit_code ? `Unit: ${item.unit_code}` : null,
    getReceiptItemDescription(item),
  ].filter(Boolean) as string[];
}

function formatOptionalReceiptDate(value: Date | string | null | undefined) {
  if (!value) return null;

  if (value instanceof Date) {
    return formatReceiptDate(value.toISOString());
  }

  return formatReceiptDate(value);
}

function getMerchantAddressLine(
  merchant: ReceiptMerchant,
  documentKind: 'invoice' | 'receipt'
) {
  if (documentKind === 'invoice' && merchant.registered_address) {
    const address = merchant.registered_address;
    const registeredAddressLine = [
      address.street,
      address.city,
      address.state,
      address.postal_code,
      address.country,
    ]
      .filter(Boolean)
      .join(', ');

    if (registeredAddressLine) {
      return registeredAddressLine;
    }
  }

  return merchant.business_address;
}

function getLogoImageFormat(dataUri: string) {
  if (dataUri.startsWith('data:image/png;')) return 'PNG';
  if (dataUri.startsWith('data:image/jpeg;')) return 'JPEG';
  if (dataUri.startsWith('data:image/jpg;')) return 'JPEG';
  if (dataUri.startsWith('data:image/webp;')) return 'WEBP';
  return null;
}

function drawMerchantLogo(input: {
  doc: jsPDF;
  logoDataUri: string | null | undefined;
  x: number;
  y: number;
  maxWidth: number;
  maxHeight: number;
}) {
  if (!input.logoDataUri) {
    return false;
  }

  const format = getLogoImageFormat(input.logoDataUri);
  if (!format) {
    return false;
  }

  try {
    input.doc.addImage(
      input.logoDataUri,
      format,
      input.x,
      input.y,
      input.maxWidth,
      input.maxHeight,
      undefined,
      'FAST'
    );
    return true;
  } catch {
    return false;
  }
}

function isSupportedLogoContentType(contentType: string) {
  return (
    contentType.startsWith('image/png') ||
    contentType.startsWith('image/jpeg') ||
    contentType.startsWith('image/jpg') ||
    contentType.startsWith('image/webp')
  );
}

function isTrustedLogoUrl(parsedUrl: URL) {
  if (parsedUrl.protocol !== 'https:') {
    return false;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    hostname === TRUSTED_MEDIA_CDN_HOSTNAME &&
    parsedUrl.pathname.startsWith(MEDIA_CDN_PUBLIC_PREFIX)
  ) {
    return true;
  }

  return (
    hostname.endsWith(SUPABASE_HOST_SUFFIX) &&
    SUPABASE_PUBLIC_LOGO_PREFIXES.some((prefix) =>
      parsedUrl.pathname.startsWith(prefix)
    )
  );
}

function mergeLogoChunks(chunks: Uint8Array[], totalBytes: number) {
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function encodeLogoBytesToBase64(bytes: Uint8Array) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triplet = (first << 16) | (second << 8) | third;

    encoded += alphabet[(triplet >> 18) & 63];
    encoded += alphabet[(triplet >> 12) & 63];
    encoded += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : '=';
    encoded += index + 2 < bytes.length ? alphabet[triplet & 63] : '=';
  }

  return encoded;
}

async function readLogoBytes(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_LOGO_BYTES) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return mergeLogoChunks(chunks, totalBytes);
}

export async function resolveReceiptLogoDataUri(merchant: ReceiptMerchant) {
  const logoUrl = merchant.logo_url?.trim();
  if (!logoUrl) return null;

  if (logoUrl.startsWith('data:image/')) {
    return logoUrl.length <= MAX_LOGO_DATA_URI_LENGTH ? logoUrl : null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(logoUrl);
  } catch {
    return null;
  }

  if (!isTrustedLogoUrl(parsedUrl)) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(parsedUrl, {
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!isSupportedLogoContentType(contentType)) return null;

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_LOGO_BYTES) return null;

    const imageBytes = await readLogoBytes(response);
    if (!imageBytes) return null;

    const base64 = encodeLogoBytesToBase64(imageBytes);
    return `data:${contentType.split(';')[0]};base64,${base64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function generateReceiptPDF(
  order: ReceiptOrder,
  merchant: ReceiptMerchant,
  options: GenerateReceiptPdfOptions = {}
) {
  const doc = new jsPDF() as JsPDFWithAutoTable;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const columnGap = 12;
  const columnWidth = (contentWidth - columnGap) / 2;
  const currency = order.currency || 'NGN';
  const isPaid = order.payment_status === 'paid';
  const documentKind = options.documentKind ?? (isPaid ? 'receipt' : 'invoice');
  const isInvoice = documentKind === 'invoice';
  const documentLabel = isInvoice
    ? getInvoiceDocumentLabel(options.invoiceTypeCode)
    : 'RECEIPT';
  const displayDocumentDate =
    formatOptionalReceiptDate(options.documentDate) ||
    formatReceiptDate(order.transaction_date ?? order.created_at);
  const displayDueDate = formatOptionalReceiptDate(options.dueDate);
  const firsIrn = options.firsIrn?.trim();
  const firsCsid = options.firsCsid?.trim();
  const invoiceNotes = options.invoiceNotes?.trim();
  const taxSubtotals = options.taxSubtotals?.filter(
    (subtotal) =>
      Number.isFinite(subtotal.taxable_amount) &&
      Number.isFinite(subtotal.tax_amount) &&
      Number.isFinite(subtotal.vat_rate) &&
      Boolean(subtotal.vat_category_code.trim())
  );
  const hasLineTaxDetail =
    isInvoice &&
    (order.items || []).some(
      (item) =>
        (typeof item.vat_rate === 'number' && Number.isFinite(item.vat_rate)) ||
        (typeof item.vat_amount === 'number' &&
          Number.isFinite(item.vat_amount))
    );
  const brandPrimaryRgb = getBrandPrimaryRgb(merchant);
  let y = margin;

  doc.setFillColor(...brandPrimaryRgb);
  doc.roundedRect(margin, y, pageWidth - margin * 2, 24, 4, 4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(documentLabel, margin + 8, y + 10);
  doc.setFontSize(10);
  doc.text(`#${order.order_number}`, pageWidth - margin - 8, y + 10, {
    align: 'right',
  });
  doc.text(displayDocumentDate, pageWidth - margin - 8, y + 17, {
    align: 'right',
  });
  y += 34;

  doc.setTextColor(17, 24, 39);
  doc.setFontSize(15);
  const logoDrawn = drawMerchantLogo({
    doc,
    logoDataUri: options.logoDataUri,
    x: margin,
    y,
    maxWidth: 34,
    maxHeight: 16,
  });

  if (logoDrawn) {
    y += 20;
  }

  y = writeWrappedTextLines({
    doc,
    lines: [merchant.legal_entity_name || merchant.business_name || 'Store'],
    x: margin,
    y,
    maxWidth: columnWidth,
    lineHeight: 6,
  });
  y += 1;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  y = writeWrappedTextLines({
    doc,
    lines: [
      getMerchantAddressLine(merchant, documentKind),
      merchant.support_phone || merchant.phone,
      // Public support email only — never leak `merchant.email` (the private
      // login address) onto a customer-facing receipt.
      merchant.support_email || null,
      merchant.tax_identification_number
        ? `TIN: ${merchant.tax_identification_number}`
        : null,
    ],
    x: margin,
    y,
    maxWidth: columnWidth,
  });

  const rightColumnX = margin + columnWidth + columnGap;
  let rightY = margin + 36;
  doc.setFont('helvetica', 'bold');
  doc.text('Billed To', rightColumnX, rightY);
  rightY += 6;
  doc.setFont('helvetica', 'normal');
  rightY = writeWrappedTextLines({
    doc,
    lines: [
      order.customer_name,
      order.customer_email,
      order.customer_phone,
      ...getAddressLines(order),
    ],
    x: rightColumnX,
    y: rightY,
    maxWidth: columnWidth,
  });

  y = Math.max(y, rightY) + 6;

  autoTable(doc, {
    startY: y,
    head: [
      hasLineTaxDetail
        ? ['Item', 'Qty', 'Unit Price', 'VAT', 'Line Total']
        : ['Item', 'Qty', 'Unit Price', 'Line Total'],
    ],
    body: (order.items || []).map((item) => {
      const itemName = formatOrderItemDisplayName({
        baseName: item.product_name || item.name || 'Item',
        condition: item.condition,
        variantName: getReceiptItemVariantName(item),
      });
      const itemDetails = getReceiptItemDetailLines(item);
      const itemLabel =
        itemDetails.length > 0
          ? `${itemName}\n${itemDetails.join('\n')}`
          : itemName;
      const commonColumns = [
        itemLabel,
        String(item.quantity),
        formatReceiptCurrency(item.price, currency),
      ];

      return hasLineTaxDetail
        ? [
            ...commonColumns,
            getReceiptItemTaxLabel(item, currency),
            formatReceiptCurrency(getReceiptItemLineTotal(item), currency),
          ]
        : [
            ...commonColumns,
            formatReceiptCurrency(getReceiptItemLineTotal(item), currency),
          ];
    }),
    styles: {
      fontSize: 10,
      cellPadding: 4,
      lineColor: [229, 231, 235],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [...brandPrimaryRgb],
      textColor: [255, 255, 255],
    },
    pageBreak: 'auto',
  });

  y = (doc.lastAutoTable?.finalY || y) + 10;
  const totalsX = pageWidth - margin - 68;
  const ensureSpace = (spaceNeeded: number) => {
    const pageHeight = doc.internal.pageSize.getHeight();

    if (y + spaceNeeded <= pageHeight - margin) {
      return;
    }

    doc.addPage();
    y = margin;
  };
  const writeSummaryRow = (
    label: string,
    value: string,
    emphasized = false
  ) => {
    ensureSpace(8);
    doc.setFont('helvetica', emphasized ? 'bold' : 'normal');
    doc.text(label, totalsX, y);
    doc.text(value, pageWidth - margin, y, { align: 'right' });
    y += 6;
  };

  const formatSummaryAmount = (value: number | null | undefined) =>
    formatReceiptCurrency(
      typeof value === 'number' && Number.isFinite(value) ? value : 0,
      currency
    );

  writeSummaryRow('Subtotal', formatSummaryAmount(order.subtotal));
  writeSummaryRow(
    'Shipping',
    order.shipping_fee > 0 ? formatSummaryAmount(order.shipping_fee) : 'Free'
  );

  if (order.discount_amount > 0) {
    writeSummaryRow(
      'Discount',
      `-${formatSummaryAmount(order.discount_amount)}`
    );
  }

  if (order.tax_amount > 0) {
    writeSummaryRow('Tax', formatSummaryAmount(order.tax_amount));
  }

  writeSummaryRow('Total', formatSummaryAmount(order.total), true);

  if (isInvoice || order.amount_paid > 0) {
    writeSummaryRow('Amount Paid', formatSummaryAmount(order.amount_paid));
    if (order.balance > 0) {
      writeSummaryRow('Balance Due', formatSummaryAmount(order.balance), true);
    }
  }

  if (isInvoice && taxSubtotals && taxSubtotals.length > 0) {
    y += 4;
    ensureSpace(28);
    doc.setFont('helvetica', 'bold');
    doc.text('VAT Breakdown', margin, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [['Category', 'Rate', 'Taxable Amount', 'Tax Amount']],
      body: taxSubtotals.map((subtotal) => [
        subtotal.exemption_reason
          ? `${subtotal.vat_category_code}\n${subtotal.exemption_reason}`
          : subtotal.vat_category_code,
        `${subtotal.vat_rate.toFixed(2)}%`,
        formatReceiptCurrency(subtotal.taxable_amount, currency),
        formatReceiptCurrency(subtotal.tax_amount, currency),
      ]),
      styles: {
        fontSize: 9,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [31, 41, 55],
        textColor: [255, 255, 255],
      },
      pageBreak: 'auto',
    });
    y = (doc.lastAutoTable?.finalY || y) + 8;
  }

  if (order.transactions && order.transactions.length > 0) {
    y += 4;
    ensureSpace(20);
    autoTable(doc, {
      startY: y,
      head: [['Payment Date', 'Method', 'Amount']],
      body: order.transactions.map((tx) => [
        formatReceiptDate(tx.created_at),
        tx.metadata?.payment_method || tx.description || 'Payment',
        formatReceiptCurrency(tx.amount, currency),
      ]),
      styles: {
        fontSize: 9,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [31, 41, 55],
        textColor: [255, 255, 255],
      },
      pageBreak: 'auto',
    });
    y = (doc.lastAutoTable?.finalY || y) + 8;
  }

  if (
    isInvoice &&
    (displayDueDate || options.paymentTerms || options.buyerReference)
  ) {
    ensureSpace(22);
    doc.setFont('helvetica', 'bold');
    doc.text('Invoice Terms', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    y = writeWrappedTextLines({
      doc,
      lines: [
        options.buyerReference
          ? `Buyer Reference: ${options.buyerReference}`
          : null,
        displayDueDate ? `Due Date: ${displayDueDate}` : null,
        options.paymentTerms ? `Payment Terms: ${options.paymentTerms}` : null,
      ],
      x: margin,
      y,
      maxWidth: contentWidth,
    });
  }

  if (
    isInvoice &&
    order.balance > 0 &&
    (order.virtual_account || merchant.bank_account_number)
  ) {
    ensureSpace(24);
    doc.setFont('helvetica', 'bold');
    doc.text('Payment Instructions', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    const bankLines = order.virtual_account
      ? [
          `Bank: ${order.virtual_account.bank_name}`,
          `Account Name: ${order.virtual_account.account_name}`,
          `Account Number: ${order.virtual_account.account_number}`,
        ]
      : ([
          merchant.bank_name ? `Bank: ${merchant.bank_name}` : null,
          merchant.bank_account_name || merchant.business_name
            ? `Account Name: ${merchant.bank_account_name || merchant.business_name}`
            : null,
          merchant.bank_account_number
            ? `Account Number: ${merchant.bank_account_number}`
            : null,
        ].filter(Boolean) as string[]);

    y = writeWrappedTextLines({
      doc,
      lines: bankLines,
      x: margin,
      y,
      maxWidth: contentWidth,
    });
  }

  if (isInvoice && invoiceNotes) {
    ensureSpace(20);
    doc.setFont('helvetica', 'bold');
    doc.text('Invoice Notes', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    y = writeWrappedTextLines({
      doc,
      lines: [invoiceNotes],
      x: margin,
      y,
      maxWidth: contentWidth,
    });
  }

  if (isInvoice && (firsIrn || firsCsid)) {
    ensureSpace(24);
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    doc.text('FIRS References', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    y = writeWrappedTextLines({
      doc,
      lines: [
        firsIrn ? `FIRS IRN: ${firsIrn}` : null,
        firsCsid ? `FIRS CSID: ${firsCsid}` : null,
      ],
      x: margin,
      y,
      maxWidth: contentWidth,
    });
  }

  if (isInvoice && options.complianceNote) {
    ensureSpace(18);
    y += 5;
    doc.setDrawColor(229, 231, 235);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(75, 85, 99);
    y = writeWrappedTextLines({
      doc,
      lines: [options.complianceNote],
      x: margin,
      y,
      maxWidth: contentWidth,
      lineHeight: 4,
    });
  }

  return doc;
}

function getInvoiceDocumentLabel(invoiceTypeCode: string | null | undefined) {
  switch (invoiceTypeCode) {
    case '381':
      return 'CREDIT NOTE';
    case '383':
      return 'DEBIT NOTE';
    case '384':
      return 'CORRECTED INVOICE';
    case '386':
      return 'PREPAYMENT INVOICE';
    case '389':
      return 'SELF-BILLED INVOICE';
    default:
      return 'INVOICE';
  }
}

export function generateReceiptBlob(
  order: ReceiptOrder,
  merchant: ReceiptMerchant,
  options?: GenerateReceiptPdfOptions
) {
  return generateReceiptPDF(order, merchant, options).output('blob');
}
