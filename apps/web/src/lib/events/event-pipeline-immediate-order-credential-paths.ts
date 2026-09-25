const envPath = 'apps/web/src/env.ts';
const adminPath = 'apps/web/src/lib/supabase/admin.ts';
const ordersRoutePath = 'apps/web/src/app/api/orders/route.ts';
const notificationPath = 'apps/web/src/lib/immediate-order-notification.ts';
const confirmationEmailPath =
  'apps/web/src/lib/immediate-order/confirmation-email.ts';
const invoiceArtifactsPath =
  'apps/web/src/lib/immediate-order/invoice-artifacts.ts';
const merchantNotificationsPath =
  'apps/web/src/lib/immediate-order/merchant-notifications.ts';
const payformeDvaPath = 'apps/web/src/lib/immediate-order/payforme-dva.ts';
const zeptomailPath = 'apps/web/src/lib/zeptomail.ts';
const dispatchPath = 'apps/web/src/lib/order-notification-dispatch.ts';
const expoPushPath = 'apps/web/src/lib/expo-push.ts';
const persistPath =
  'apps/web/src/lib/payments/persist-paystack-dva-assignment.ts';
const reservePath =
  'apps/web/src/lib/payments/reserve-paystack-dva-assignment.ts';
const deliverClaimedPath =
  'apps/web/src/lib/immediate-order/deliver-claimed-notification.ts';

/**
 * Audited immediate-order notification edges (invoice funnel): the order
 * confirmation mail, invoice/proforma artifacts, merchant notifications,
 * and Pay-for-Me DVA provisioning fan out through the pre-existing
 * audited ZeptoMail/Expo/persist-DVA senders below. Each root's full
 * chain is registered because the boundary gate matches chains exactly.
 */
export const eventPipelineImmediateOrderCredentialPaths = [
  [
    ordersRoutePath,
    notificationPath,
    confirmationEmailPath,
    zeptomailPath,
    envPath,
  ],
  // ZeptoMail's audit sink reaches the admin client (best-effort email
  // attempt inserts): register the admin-inclusive variants exactly.
  [
    ordersRoutePath,
    notificationPath,
    confirmationEmailPath,
    zeptomailPath,
    adminPath,
    envPath,
  ],
  [notificationPath, confirmationEmailPath, zeptomailPath, adminPath, envPath],
  [
    ordersRoutePath,
    notificationPath,
    invoiceArtifactsPath,
    persistPath,
    reservePath,
    envPath,
  ],
  [
    ordersRoutePath,
    notificationPath,
    merchantNotificationsPath,
    dispatchPath,
    expoPushPath,
    envPath,
  ],
  [notificationPath, confirmationEmailPath, zeptomailPath, envPath],
  [notificationPath, invoiceArtifactsPath, persistPath, reservePath, envPath],
  [notificationPath, invoiceArtifactsPath, adminPath, envPath],
  [
    notificationPath,
    merchantNotificationsPath,
    dispatchPath,
    expoPushPath,
    envPath,
  ],
  [confirmationEmailPath, zeptomailPath, envPath],
  [confirmationEmailPath, zeptomailPath, adminPath, envPath],
  [invoiceArtifactsPath, persistPath, reservePath, envPath],
  [invoiceArtifactsPath, adminPath, envPath],
  [merchantNotificationsPath, dispatchPath, expoPushPath, envPath],
  [merchantNotificationsPath, dispatchPath, expoPushPath, adminPath, envPath],
  [payformeDvaPath, persistPath, reservePath, envPath],
  // Extracted claimed-delivery helper (PR 3498): the route now fans out
  // through deliver-claimed-notification.ts instead of calling the audited
  // senders inline. Same terminal senders, one additional audited hop.
  [
    ordersRoutePath,
    deliverClaimedPath,
    confirmationEmailPath,
    zeptomailPath,
    envPath,
  ],
  [
    ordersRoutePath,
    deliverClaimedPath,
    invoiceArtifactsPath,
    persistPath,
    reservePath,
    envPath,
  ],
  [deliverClaimedPath, confirmationEmailPath, zeptomailPath, envPath],
  [
    deliverClaimedPath,
    confirmationEmailPath,
    zeptomailPath,
    adminPath,
    envPath,
  ],
  [deliverClaimedPath, invoiceArtifactsPath, persistPath, reservePath, envPath],
] as const;
