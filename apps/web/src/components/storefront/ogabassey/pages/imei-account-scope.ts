/**
 * The account the IMEI checker is showing: store, customer and signed-in
 * user. The history list and the check hook both use it, so a report is
 * only ever opened for the account it was listed for.
 */
export function imeiAccountScope(
  merchantSlug: string | undefined,
  auth:
    | { customer?: { id?: string } | null; user?: { id?: string } | null }
    | null
    | undefined
) {
  return `${merchantSlug ?? ''}:${auth?.customer?.id ?? 'anonymous'}:${auth?.user?.id ?? ''}`;
}
