/**
 * Canonical receipt line name for the Ogabassey Assurance (MyCover device
 * cover) premium. The fee is server-computed per item and VAT-exempt, so
 * renderers itemize it under this single name to reconcile printed lines
 * with the total.
 *
 * Defined here (not in apps/web) so the mobile receipt preview imports the
 * same value instead of mirroring the literal; cross-app imports of
 * apps/web are not allowed.
 */
export const ASSURANCE_LINE_NAME = 'Ogabassey Assurance';
