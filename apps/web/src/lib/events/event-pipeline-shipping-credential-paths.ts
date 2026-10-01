const envPath = 'apps/web/src/env.ts';
const adminPath = 'apps/web/src/lib/supabase/admin.ts';
const proofPath = 'apps/web/src/lib/shipping/shipping-quote-route-proof.ts';
const persistRefreshedPath =
  'apps/web/src/lib/shipping/persist-refreshed-shipping-quote.ts';
const persistAdminPath =
  'apps/web/src/lib/shipping/persist-admin-gigl-quote.ts';
const refreshPath = 'apps/web/src/lib/shipping/refresh-order-shipment-quote.ts';
const refreshWalletPath =
  'apps/web/src/lib/shipping/refresh-wallet-order-shipment-quote.ts';
const bookShipmentPath = 'apps/web/src/lib/shipping/book-order-shipment.ts';
const claimedBookingPath =
  'apps/web/src/lib/shipping/run-claimed-order-wallet-or-checkout-booking.ts';
const bookingEconomicsPath =
  'apps/web/src/lib/shipping/shipping-quote-booking-economics.ts';
const bookingEconomicsClientPath =
  'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts';
const servicePath = 'apps/web/src/lib/supabase/service.ts';
const resolveBookingPath =
  'apps/web/src/app/api/shipping/book/resolve-booking-quote-for-sender.ts';
const executeDirectPath =
  'apps/web/src/app/api/shipping/book/execute-direct-booking-attempt.ts';
const bookRoutePath = 'apps/web/src/app/api/shipping/book/route.ts';
const adminGiglQuotePath =
  'apps/web/src/app/api/shipping/quotes/admin-order-gigl-quote.ts';
const quotesRoutePath = 'apps/web/src/app/api/shipping/quotes/route.ts';
const orderRoutePath = 'apps/web/src/app/api/orders/[id]/route.ts';
const giglQuoteRoutePath =
  'apps/web/src/app/api/orders/[id]/shipping/gigl-quote/route.ts';

export const eventPipelineShippingCredentialPaths = [
  [proofPath, envPath],
  [persistRefreshedPath, proofPath, envPath],
  [persistAdminPath, proofPath, envPath],
  [refreshPath, persistRefreshedPath, proofPath, envPath],
  [refreshWalletPath, refreshPath, persistRefreshedPath, proofPath, envPath],
  [bookShipmentPath, refreshPath, persistRefreshedPath, proofPath, envPath],
  [resolveBookingPath, refreshPath, persistRefreshedPath, proofPath, envPath],
  [
    executeDirectPath,
    resolveBookingPath,
    refreshPath,
    persistRefreshedPath,
    proofPath,
    envPath,
  ],
  [
    bookRoutePath,
    executeDirectPath,
    resolveBookingPath,
    refreshPath,
    persistRefreshedPath,
    proofPath,
    envPath,
  ],
  [adminGiglQuotePath, persistAdminPath, proofPath, envPath],
  [quotesRoutePath, adminGiglQuotePath, persistAdminPath, proofPath, envPath],
  [quotesRoutePath, adminPath, envPath],
  [giglQuoteRoutePath, quotesRoutePath, adminPath, envPath],
  [
    giglQuoteRoutePath,
    quotesRoutePath,
    adminGiglQuotePath,
    persistAdminPath,
    proofPath,
    envPath,
  ],
  [
    orderRoutePath,
    bookShipmentPath,
    refreshPath,
    persistRefreshedPath,
    proofPath,
    envPath,
  ],
  [
    claimedBookingPath,
    bookShipmentPath,
    refreshPath,
    persistRefreshedPath,
    proofPath,
    envPath,
  ],
  [
    claimedBookingPath,
    refreshWalletPath,
    refreshPath,
    persistRefreshedPath,
    proofPath,
    envPath,
  ],
  [
    claimedBookingPath,
    bookingEconomicsPath,
    bookingEconomicsClientPath,
    servicePath,
    envPath,
  ],
  [
    bookShipmentPath,
    bookingEconomicsPath,
    bookingEconomicsClientPath,
    servicePath,
    envPath,
  ],
  [
    orderRoutePath,
    claimedBookingPath,
    bookShipmentPath,
    refreshPath,
    persistRefreshedPath,
    proofPath,
    envPath,
  ],
  [
    orderRoutePath,
    claimedBookingPath,
    refreshWalletPath,
    refreshPath,
    persistRefreshedPath,
    proofPath,
    envPath,
  ],
  [
    orderRoutePath,
    claimedBookingPath,
    bookingEconomicsPath,
    bookingEconomicsClientPath,
    servicePath,
    envPath,
  ],
  [
    orderRoutePath,
    bookShipmentPath,
    bookingEconomicsPath,
    bookingEconomicsClientPath,
    servicePath,
    envPath,
  ],
] as const;
