import z from 'zod';
import {
  type BankTransferInflowSuccessEvent,
  bankTransferInflowSuccessEventSchema,
} from './bank-transfer-inflow-event';
import {
  type InterestPayoutSuccessEvent,
  interestPayoutSuccessEventSchema,
} from './interest-payout-event';

/**
 * Versioned PiggyVest staging webhook event schemas (composition root).
 *
 * Each event route is defined in its own module; this file composes the
 * versioned union and re-exports the route schemas so existing imports keep
 * working.
 *
 * Source: provider message shared 17 Sep 2026 (two sample payloads).
 * Status: schema-drafted from samples. NOT provider-certified.
 * Activation remains blocked pending retry/redelivery contract,
 * signed raw-byte samples, and credential provisioning.
 */

export const piggyvestWebhookEventSchema = z.discriminatedUnion('eventType', [
  bankTransferInflowSuccessEventSchema,
  interestPayoutSuccessEventSchema,
]);

export type PiggyvestWebhookEvent = z.infer<typeof piggyvestWebhookEventSchema>;

export {
  type BankTransferInflowSuccessEvent,
  bankTransferInflowSuccessEventSchema,
  type InterestPayoutSuccessEvent,
  interestPayoutSuccessEventSchema,
};
