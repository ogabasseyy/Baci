import { eventPipelineAdsServicePaths } from '@/lib/events/event-pipeline-ads-service-paths';
import { eventPipelineJumiaServicePaths } from '@/lib/events/event-pipeline-jumia-service-paths';

export const eventPipelineAuthorityServicePaths = [
  ...eventPipelineAdsServicePaths,
  ...eventPipelineJumiaServicePaths,
  // Only the proxy-rate-limited validate route (loyalty branch) and
  // the orders checkout path may drive the branded loyalty resolver
  // client (issue #3696; see the AGENTS.md temporary exception).
  [
    'apps/web/src/app/api/storefront/discount/validate/route.ts',
    'apps/web/src/lib/loyalty/server-resolver-client.ts',
  ],
  // Only the token-scoped login-email route may drive the branded
  // receipt login-hint client (PR #3580; see the temporary exception in
  // AGENTS.md). The 256-bit claim Bearer [REDACTED] is the only credential on this
  // path; the raw address is masked before responding. The loader builds
  // the client lazily after anon preview validation, so every loader
  // importer shares the transitive edge below (none constructs it).
  [
    'apps/web/src/app/api/storefront/receipts/claims/[token]/login-email/route.ts',
    'apps/web/src/lib/receipts/server-login-hint-client.ts',
  ],
  [
    'apps/web/src/app/api/storefront/receipts/claims/[token]/login-email/route.ts',
    'apps/web/src/lib/import-notifications/receipt-claim-preview.ts',
    'apps/web/src/lib/receipts/server-login-hint-client.ts',
  ],
  [
    'apps/web/src/app/api/storefront/receipts/claims/[token]/route.ts',
    'apps/web/src/lib/import-notifications/receipt-claim-preview.ts',
    'apps/web/src/lib/receipts/server-login-hint-client.ts',
  ],
  [
    'apps/web/src/app/api/storefront/receipts/claims/[token]/app-download-click/route.ts',
    'apps/web/src/lib/import-notifications/receipt-claim-preview.ts',
    'apps/web/src/lib/receipts/server-login-hint-client.ts',
  ],
  [
    'apps/web/src/app/(storefront)/[slug]/(customer)/receipts/claim/[token]/page.tsx',
    'apps/web/src/lib/import-notifications/receipt-claim-preview.ts',
    'apps/web/src/lib/receipts/server-login-hint-client.ts',
  ],
  [
    'apps/web/src/app/api/orders/route.ts',
    'apps/web/src/lib/checkout/prepare-loyalty-checkout.ts',
    'apps/web/src/lib/checkout/resolve-loyalty-checkout-code.ts',
    'apps/web/src/lib/loyalty/server-resolver-client.ts',
  ],
  // Only the HMAC-authenticated PiggyVest webhook may drive the branded
  // intake client (see server-intake-client.ts boundary doc).
  [
    'apps/web/src/app/api/webhooks/piggyvest/route.ts',
    'apps/web/src/lib/piggyvest/server-intake-client.ts',
  ],
  [
    'apps/web/src/app/api/cron/provision-wallet-funding-recovery-hmac/route.ts',
    'apps/web/src/lib/wallet/server-funding-recovery-hmac-client.ts',
  ],
  [
    'apps/web/src/app/api/cron/provision-immediate-notification-completion-hmac/route.ts',
    'apps/web/src/lib/immediate-order/server-completion-hmac-client.ts',
  ],
  [
    'apps/web/src/lib/shipping/shipping-quote-booking-economics.ts',
    'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts',
  ],
  [
    'apps/web/src/lib/shipping/run-claimed-order-wallet-or-checkout-booking.ts',
    'apps/web/src/lib/shipping/shipping-quote-booking-economics.ts',
    'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts',
  ],
  [
    'apps/web/src/app/api/orders/[id]/route.ts',
    'apps/web/src/lib/shipping/run-claimed-order-wallet-or-checkout-booking.ts',
    'apps/web/src/lib/shipping/shipping-quote-booking-economics.ts',
    'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts',
  ],
  [
    'apps/web/src/lib/shipping/book-order-shipment.ts',
    'apps/web/src/lib/shipping/shipping-quote-booking-economics.ts',
    'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts',
  ],
  [
    'apps/web/src/app/api/orders/[id]/route.ts',
    'apps/web/src/lib/shipping/book-order-shipment.ts',
    'apps/web/src/lib/shipping/shipping-quote-booking-economics.ts',
    'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts',
  ],
  [
    'apps/web/src/app/api/shipping/book/load-direct-booking-context.ts',
    'apps/web/src/lib/shipping/shipping-quote-booking-economics.ts',
    'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts',
  ],
  [
    'apps/web/src/app/api/shipping/book/route.ts',
    'apps/web/src/app/api/shipping/book/load-direct-booking-context.ts',
    'apps/web/src/lib/shipping/shipping-quote-booking-economics.ts',
    'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts',
  ],
  [
    'apps/web/src/app/api/storefront/product-requests/route.ts',
    'apps/web/src/lib/storefront/server-intake-client.ts',
  ],
  // Only the public search-submissions endpoint may drive the branded
  // search-analytics ingestion edge (#3581, owner-approved temporary
  // exception recorded in AGENTS.md; expires 2027-01-07).
  [
    'apps/web/src/app/api/search/submissions/route.ts',
    'apps/web/src/lib/search/server-analytics-client.ts',
  ],
] as const;
