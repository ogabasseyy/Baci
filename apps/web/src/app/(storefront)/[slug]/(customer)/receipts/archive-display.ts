import type { StorefrontOrder } from '@/types/storefront-order';

const ARCHIVE_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  // The emailed/downloaded PDFs date receipts in Africa/Lagos: a browser
  // timezone here would show a different calendar date near midnight.
  timeZone: 'Africa/Lagos',
});

const ARCHIVE_DATE_ONLY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function formatArchiveDate(value: string | null | undefined) {
  if (!value) {
    return '-';
  }
  // Date-only values are calendar dates with no time component: midnight
  // UTC plus a local formatter would show the previous day west of UTC,
  // so format them in UTC like the shared receipt date handling.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = new Date(`${value}T00:00:00.000Z`);

    if (Number.isNaN(day.getTime())) {
      return '-';
    }

    return ARCHIVE_DATE_ONLY_FORMATTER.format(day);
  }
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return ARCHIVE_DATE_FORMATTER.format(date);
}

/**
 * Customer-facing document label for an archived order. The invoice route
 * downloads a 325 proforma for unpaid invoice-method orders, so the badge,
 * download CTA, and type search must say proforma — not invoice — for the
 * same document. Download hrefs still use `current_document_kind`.
 */
export function resolveArchiveDocumentKind(order: StorefrontOrder) {
  const kind = order.current_document_kind || 'invoice';
  if (kind === 'receipt') {
    return kind;
  }
  return order.invoice_type_code === '325' ? 'proforma' : kind;
}
