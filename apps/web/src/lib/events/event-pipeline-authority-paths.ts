export const eventPipelineAdminImporters = [
  // CRON_SECRET-authenticated fallback; only the bounded recovery retention RPC.
  'apps/web/src/app/api/cron/cleanup-checkout-shipping-recovery-previews/route.ts',
  'apps/web/src/app/api/cron/purge-jumia-self-authorization-discoveries/route.ts',
  'apps/web/src/app/api/orders/route.ts',
  'apps/web/src/app/api/payments/juicyway/webhook/route.ts',
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
  // Audited manual-order document sender (PR 3580): CRON-authenticated outbox
  // worker dispatches receipt/invoice email only through the audited Zeptomail
  // sender, matching repair-notifications.ts above. Document reads ride the
  // claim-bound snapshot RPC and the claim-sent marker RPC; direct table
  // access is limited to the worker-owned dispatch lease below.
  'apps/web/src/lib/send-manual-order-document.ts',
  // Audited manual-order document login hint (PR 3580): the token-scoped
  // login-email route resolves the recipient address through the
  // service-role-only login-hint RPC. The 256-bit claim Bearer [REDACTED] is the
  // only credential; no table access, no mail sending on this path.
  'apps/web/src/app/api/storefront/receipts/claims/[token]/login-email/route.ts',
] as const;
