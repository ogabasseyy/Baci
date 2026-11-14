import { z } from 'zod';

const claimedNotificationSchema = z.object({
  audience: z.enum(['merchant', 'customer']),
  id: z.uuid(),
  merchant_id: z.uuid(),
  notification_kind: z.string().min(1),
  // Repair-pickup outbox rows may be orderless; shipment_id is the durable key.
  order_id: z.uuid().nullable(),
  // Projected by claim_shipment_tracking_notifications for orderless pickups.
  repair_id: z.uuid().nullable().optional(),
  // Owner + orders.fulfill staff user ids, projected by the claim RPC for
  // merchant rows. An empty array means nobody qualifies.
  recipient_user_ids: z.array(z.uuid()).nullable().optional(),
  shipment_id: z.uuid(),
  tracking_event_id: z.uuid(),
});

export const claimedGiglTrackingNotificationsSchema = z.array(
  claimedNotificationSchema
);
export type ClaimedGiglTrackingNotification = z.infer<
  typeof claimedNotificationSchema
>;
