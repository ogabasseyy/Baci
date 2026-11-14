// A Map, not an object: a source type such as "constructor" must never
// resolve to an inherited Object.prototype member.
export const LABEL_BY_SOURCE: ReadonlyMap<string, string> = new Map(
  Object.entries({
    wallet_topup: 'Wallet top-up',
    imei_wallet_payment: 'IMEI check',
    imei_wallet_refund: 'IMEI check refund',
    // Stored as "PiggyVest bank transfer" / "PiggyVest card funding".
    piggyvest_primary_inflow: 'Money added',
    piggyvest_primary_card_custody: 'Card top-up',
  })
);

// Internal ids: UUIDs, shortened hex ("3f2b…") and
// long digit runs such as an IMEI or provider reference (never an amount or
// the customer's own phone number).
export const IDS = [
  /:?\s*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /:?\s*\b(?=[0-9a-f]*\d)[0-9a-f]{3,}(?:…|\.{3})/gi,
  // 15–16 digits: an IMEI (or IMEISV). A phone number (+234 is 13 digits) and
  // a 20-digit electricity token the customer needs both stay.
  /(?<![₦\d,.])\b\d{15,16}\b/g,
];
