// Manual-origin channels whose document dates derive from the device-local
// picker day. Keep in sync with the source list in
// 20261008103000_allow_admin_order_date_edit.sql and
// update_transaction_review_details.
const MANUAL_ORDER_SOURCES: ReadonlySet<string> = new Set([
  'manual',
  'staff_entry',
  'physical',
  'instagram',
  'whatsapp',
  'facebook',
  'tiktok',
  'jumia',
  'jiji',
  'konga',
]);

export function isManualOrderSource(
  source: string | null | undefined
): boolean {
  return typeof source === 'string' && MANUAL_ORDER_SOURCES.has(source);
}
