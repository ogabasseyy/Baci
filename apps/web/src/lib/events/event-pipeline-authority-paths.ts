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
] as const;
