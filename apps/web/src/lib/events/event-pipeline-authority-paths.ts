export const eventPipelineAdminImporters = [
  'apps/web/src/app/api/cron/purge-jumia-self-authorization-discoveries/route.ts',
  'apps/web/src/app/api/orders/route.ts',
  'apps/web/src/app/api/payments/juicyway/webhook/route.ts',
  'apps/web/src/app/api/platform/events/platform-event-forwarding.ts',
  'apps/web/src/app/api/shipping/quotes/route.ts',
  'apps/web/src/lib/events/record-platform-order-created-event.ts',
  'apps/web/src/lib/expo-push.ts',
  'apps/web/src/lib/insurance/notify-activate-protection.ts',
  'apps/web/src/lib/repair-notifications.ts',
  'apps/web/src/lib/shipping/persist-admin-gigl-quote.ts',
  'apps/web/src/lib/shipping/persist-refreshed-shipping-quote.ts',
  'apps/web/src/lib/payments/resolve-order-gateway-completion.ts',
  // Audited immediate-order notification senders (invoice funnel): build
  // invoice/proforma artifacts and confirmation mail with the admin client,
  // matching repair-notifications.ts above.
  'apps/web/src/lib/immediate-order/invoice-artifacts.ts',
  'apps/web/src/lib/immediate-order/confirmation-email.ts',
  // Extracted Credit Direct failure responder (PR 3498): reaches the admin
  // client only through the audited file-inventory-confirmation-review.
  'apps/web/src/app/api/payments/credit-direct/webhook/customer-inventory-failure.ts',
] as const;
