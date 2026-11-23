import { z } from 'zod';

/** Below this the assistant hands the conversation to a person. */
export const CHAT_AUTO_REPLY_MIN_CONFIDENCE = 0.6;
/** Longest customer text sent to a model; the rest is cut. */
export const CHAT_AUTO_REPLY_MAX_QUESTION_LENGTH = 2000;
export const CHAT_AUTO_REPLY_MAX_LENGTH = 1000;

/** What the customer is doing, as the model reads their message. */
export const CHAT_AUTO_REPLY_INTENTS = [
  'discover',
  'recommend',
  'details',
  'add_to_cart',
  'other',
] as const;

export const ekaetteSpecTopics = [
  'MagSafe support',
  'SIM and eSIM support',
  'water resistance rating',
  'ports and connectors',
  'wireless connectivity',
  'battery and charging specifications',
  'camera specifications',
  'display specifications',
  'processor and memory specifications',
  'key technical specifications',
] as const;

export const chatSuggestionSchema = z.enum([
  'browse_phones',
  'compare_products',
  'pay_small_small',
  'repair_quote',
  'orders',
  'add_to_cart',
  'review_checkout',
]);
export type ChatSuggestion = z.infer<typeof chatSuggestionSchema>;

/**
 * What the model must return; anything else counts as a failed attempt. The
 * intent is advisory: a missing or unknown one is dropped (the store then just
 * adds nothing extra) rather than failing an otherwise good reply.
 */
export const checkoutNameSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
});

export const checkoutNameDecisionSchema = z.object({
  checkoutName: checkoutNameSchema.nullable(),
});

export const chatAutoReplySchema = z.object({
  reply: z.string().trim().max(CHAT_AUTO_REPLY_MAX_LENGTH),
  confidence: z.number().min(0).max(1),
  needsHuman: z.boolean(),
  intent: z.enum(CHAT_AUTO_REPLY_INTENTS).optional().catch(undefined),
  suggestions: z.array(chatSuggestionSchema).max(2).optional().catch(undefined),
  researchTopic: z.enum(ekaetteSpecTopics).optional().catch(undefined),
  checkoutHelp: z.boolean().optional().catch(undefined),
  orderHelp: z.boolean().optional().catch(undefined),
  cartAdd: z.boolean().optional().catch(undefined),
  cartOptions: z
    .array(
      z.object({
        axis: z.string().trim().min(1).max(40),
        value: z.string().trim().min(1).max(80),
      })
    )
    .max(8)
    .optional()
    .catch(undefined),
  catalogCategory: z
    .enum(['smartphones', 'laptops', 'tablets'])
    .optional()
    .catch(undefined),
  cartProductQuery: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .catch(undefined),
  productSlugs: z.array(z.string().max(160)).max(3).optional().catch(undefined),
});

export type ChatAutoReply = z.infer<typeof chatAutoReplySchema>;
