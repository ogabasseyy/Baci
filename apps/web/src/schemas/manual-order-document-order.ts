import {
  isDecimalMoney,
  MANUAL_ORDER_CURRENCY_CODE_PATTERN,
  MANUAL_ORDER_INVOICE_ONLY_ITEM_FINANCIAL_FIELDS,
  MANUAL_ORDER_ITEM_FINANCIAL_FIELDS,
  type ManualOrderInvoiceOnlyItemFinancialField,
  type ManualOrderItemFinancialField,
} from '@baci/shared/receipt';
import { z } from 'zod';

// Money must match the strict gates exactly: z.coerce.number() alone
// accepts '', true, hex, and padded strings the mobile promotion gate
// demotes, so the sender would email a receipt the app badges invoice.
// Only strict decimals pass (nulls fail closed, never coerce to zero —
// SQL null is distinct from coerced zero and would loop the marker
// stale). Staff set the value and the order triggers re-arm the document.
const number = z.preprocess(
  (value) => (isDecimalMoney(value) ? value : Number.NaN),
  z.coerce.number().finite().nonnegative()
);
const positiveNumber = z.preprocess(
  (value) => (isDecimalMoney(value) ? value : Number.NaN),
  z.coerce.number().finite().positive()
);
// Receipts print no item VAT detail: the value only needs to be finite,
// never nonnegative — an unrendered negative rate must not sink the send.
const finiteNumber = z.preprocess(
  (value) => (isDecimalMoney(value) ? value : Number.NaN),
  z.coerce.number().finite()
);
const nullableText = z.string().nullable();

// Sender-validated numeric item fields, derived from the shared gate
// field list: a new validated field lands in the sender AND the archive
// gate below from this one shape, instead of two hand-mirrored lists.
const manualDocumentOrderItemFinancialShape: Record<
  ManualOrderItemFinancialField,
  ReturnType<typeof number.nullish>
> = Object.fromEntries(
  MANUAL_ORDER_ITEM_FINANCIAL_FIELDS.map((field) => [field, number.nullish()])
) as Record<ManualOrderItemFinancialField, ReturnType<typeof number.nullish>>;
const manualDocumentOrderReceiptVatShape: Record<
  ManualOrderInvoiceOnlyItemFinancialField,
  ReturnType<typeof finiteNumber.nullish>
> = Object.fromEntries(
  MANUAL_ORDER_INVOICE_ONLY_ITEM_FINANCIAL_FIELDS.map((field) => [
    field,
    finiteNumber.nullish(),
  ])
) as Record<
  ManualOrderInvoiceOnlyItemFinancialField,
  ReturnType<typeof finiteNumber.nullish>
>;
const manualDocumentOrderItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: positiveNumber,
  price: number,
  variant_name: nullableText,
  condition: nullableText,
  item_description: nullableText,
  ...manualDocumentOrderItemFinancialShape,
  unit_code: z.string().nullish(),
  vat_category_code: z.string().nullish(),
  sellers_item_id: z.string().nullish(),
});

export const manualDocumentOrderSchema = z.object({
  id: z.string(),
  merchant_id: z.string(),
  customer_id: nullableText,
  recorded_by_user_id: nullableText,
  import_job_id: nullableText,
  external_source: nullableText,
  order_number: z.string(),
  created_at: z.string(),
  transaction_date: nullableText,
  invoice_issue_date: nullableText,
  // Strictly a 3-letter code on the raw value (no trim/normalize): the
  // dispatch marker compares the raw column, so normalizing here would loop
  // it stale, while Intl throws on anything downstream that is not an
  // exact code. Invalid values fail closed and re-arm on correction.
  currency: z
    .string()
    .regex(MANUAL_ORDER_CURRENCY_CODE_PATTERN, 'Invalid currency code')
    .nullish(),
  total: number,
  subtotal: number,
  shipping_fee: number,
  tax_amount: number,
  discount_amount: number,
  amount_paid: number,
  payment_status: z.string(),
  payment_method: nullableText,
  shipping_status: z.string(),
  // Nullable: staff-recorded orders may omit the name, and the enqueue
  // trigger never requires it. The sender falls back to a display name so a
  // missing name sends instead of throwing through every retry.
  customer_name: nullableText,
  customer_email: nullableText,
  customer_phone: nullableText,
  invoice_type_code: nullableText,
  invoice_note: z.string().nullish(),
  payment_due_date: nullableText,
  payment_terms: nullableText,
  buyer_reference: nullableText,
  firs_irn: nullableText,
  firs_csid: nullableText,
  notes: z.string().nullish(),
  shipping_address: z
    .object({
      // Nullish throughout: the mobile-admin "same as customer" edit path
      // persists explicit nulls, and every key renders null as empty like
      // absent — rejecting null here would terminally skip the document
      // as order_validation_failed with no re-arm on repair.
      address: z.string().nullish(),
      address_line1: z.string().nullish(),
      address_line2: z.string().nullish(),
      city: z.string().nullish(),
      state: z.string().nullish(),
      postal_code: z.string().nullish(),
      // Mobile staff app persists camelCase; the PDF builder normalizes it.
      postalCode: z.string().nullish(),
      country: z.string().nullish(),
      // Passthrough: the dispatch marker compares the stored address key
      // set exactly, so unknown keys must survive parsing.
    })
    .passthrough()
    .nullable(),
  order_items: z.array(manualDocumentOrderItemSchema),
});

// Invoices validate item VAT strictly; receipts print none, so the same
// keys validate finite-only. Inferred types are identical (numbers), so
// consumers keep the canonical invoice type for both.
const manualDocumentReceiptOrderItemSchema =
  manualDocumentOrderItemSchema.extend(manualDocumentOrderReceiptVatShape);

export function manualDocumentOrderSchemaFor(
  documentKind: 'receipt' | 'invoice' | 'proforma_invoice'
) {
  return documentKind === 'receipt'
    ? manualDocumentOrderSchema.extend({
        order_items: z.array(manualDocumentReceiptOrderItemSchema),
      })
    : manualDocumentOrderSchema;
}

// The archive/download predicate validates through the sender's own content
// schemas, so the storefront can never advertise a document the sender
// terminally skips as order_validation_failed: the money breakdown plus
// per-item validity over non-empty items. Only the fallible fields are
// picked (ids are uuid-typed, the rest unvalidated-nullable), and unknown
// shapes fail closed via safeParse.
const manualDocumentArchiveMoneySchema = manualDocumentOrderSchema.pick({
  amount_paid: true,
  currency: true,
  discount_amount: true,
  shipping_fee: true,
  subtotal: true,
  tax_amount: true,
  total: true,
});
// The archive item schema derives from the same financial shape as the
// sender: no hand-mirrored key list to drift. The name/price/quantity
// core is stable primitives; the validated financials can never be
// omitted here while the sender rejects them.
const manualDocumentArchiveItemSchema = z.object({
  name: z.string(),
  price: number,
  quantity: positiveNumber,
  ...manualDocumentOrderItemFinancialShape,
});
// Receipts print no item VAT: same keys, finite-only values, so the
// archive agrees with the sender instead of hand-mirroring the split.
const manualDocumentArchiveReceiptItemSchema =
  manualDocumentArchiveItemSchema.extend(manualDocumentOrderReceiptVatShape);

export interface ManualDocumentArchiveMoney {
  total?: number | string | null;
  subtotal?: number | string | null;
  shipping_fee?: number | string | null;
  tax_amount?: number | string | null;
  discount_amount?: number | string | null;
  amount_paid?: number | string | null;
  currency?: string | null;
}

export type ManualDocumentArchiveItem = {
  name?: unknown;
  price?: unknown;
  quantity?: unknown;
} & {
  [K in ManualOrderItemFinancialField]?: unknown;
};

export function isManualOrderDocumentContentValid(
  order: unknown,
  items: unknown,
  invoiceKind = true
): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  const itemSchema = invoiceKind
    ? manualDocumentArchiveItemSchema
    : manualDocumentArchiveReceiptItemSchema;
  return (
    manualDocumentArchiveMoneySchema.safeParse(order).success &&
    z.array(itemSchema).safeParse(items).success
  );
}
