/**
 * The account an IMEI screen is showing: store, customer and signed-in user.
 * Results, report history and follow-ups all belong to exactly one of these.
 */
export function imeiAccountScope(state: {
  merchantId?: string | null;
  customer?: { id?: string } | null;
  session?: { user?: { id?: string } | null } | null;
}) {
  // Explicit sentinels (as on web): a missing piece never reads 'undefined'.
  return `${state.merchantId ?? ''}:${state.customer?.id ?? 'anonymous'}:${state.session?.user?.id ?? ''}`;
}
