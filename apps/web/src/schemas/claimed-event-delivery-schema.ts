import { z } from 'zod';

export const claimedEventDeliverySchema = z.strictObject({
  attempt_number: z.number().int().positive(),
  claim_token: z.uuid(),
  claimed_at: z.iso.datetime({ offset: true }),
  destination: z.enum(['facebook', 'ga4', 'snapchat', 'tiktok', 'chatgpt']),
  domain_event_id: z.uuid(),
  id: z.uuid(),
  payload: z.unknown(),
});
