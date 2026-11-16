/**
 * The account an IMEI screen is showing: store, customer and signed-in user.
 * Results, report history and follow-ups all belong to exactly one of these.
 */
export function imeiAccountScope(state: {
  merchantId?: string | null;
  customer?: { id?: string } | null;
  session?: { user?: { id?: string } | null } | null;
}) {
  return `${state.merchantId ?? undefined}:${state.customer?.id}:${state.session?.user?.id ?? ''}`;
}
