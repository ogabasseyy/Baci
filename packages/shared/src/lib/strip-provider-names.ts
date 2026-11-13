// Back-office providers (payments, checks, delivery, bills) that never belong
// in customer-facing text. Networks and billers the customer chose (MTN,
// Ikeja Electric) are not providers and stay.
const PROVIDERS =
  'petrock|piggyvest|paystack|monnify|korapay|flutterwave|kuda|credit direct|shiip|topship|gigl|gig logistics|vtpass|redvault|sickw|dhru|imeicheck';
// "(Kuda)", "[Monnify]"
const BRACKETED = new RegExp(`\\s*[([]\\s*(?:${PROVIDERS})\\s*[)\\]]`, 'gi');
// "Ikeja Electric - Kuda", "Prepaid | Monnify"
const DASHED = new RegExp(`\\s+[-–—|]\\s*(?:${PROVIDERS})\\b`, 'gi');
// "via Paystack", "from Kuda": the joining word goes with the provider.
const JOINED = new RegExp(
  `\\s*\\b(?:via|by|through|from|with)\\s+(?:${PROVIDERS})\\b`,
  'gi'
);
const BARE = new RegExp(`\\b(?:${PROVIDERS})\\b`, 'gi');

/**
 * Removes back-office provider names from text a customer will read (wallet
 * history, biller and plan names), leaving everything else as written.
 */
export function stripProviderNames(text: string): string {
  return text
    .replace(BRACKETED, '')
    .replace(DASHED, '')
    .replace(JOINED, '')
    .replace(BARE, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
