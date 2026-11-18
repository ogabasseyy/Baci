// Back-office providers (payments, checks, delivery, bills) that never belong
// in customer-facing text. Networks and billers the customer chose (MTN,
// Ikeja Electric) are not providers and stay.
export const BACK_OFFICE_PROVIDERS_PATTERN =
  'petrock|piggyvest|paystack|monnify|korapay|flutterwave|kuda|credit direct|shiip|topship|gigl|gig logistics|vtpass|redvault|sickw|dhru|imeicheck';
