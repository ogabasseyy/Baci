import { z } from 'zod';
import { slugifyInboxTag } from '@/lib/chatwoot/merchant-inbox-labels';

export const INBOX_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

/** Longest follow-up the app offers; anything further out is refused. */
export const INBOX_MAX_FOLLOW_UP_DAYS = 90;

const tagName = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .transform((value, ctx) => {
    const slug = slugifyInboxTag(value);
    if (!slug) {
      ctx.addIssue({ code: 'custom', message: 'Tag has no usable characters' });
      return z.NEVER;
    }
    return slug;
  });

/**
 * One change to a conversation. Every field is optional but at least one is
 * required; unknown keys are refused so a typo cannot silently do nothing.
 */
export const merchantInboxUpdateSchema = z
  .strictObject({
    /** `resolved` = Done; `open` = reopen. */
    status: z.enum(['open', 'resolved']).optional(),
    /** ISO time to come back to this chat; null clears the follow-up. */
    followUpAt: z.iso.datetime().nullable().optional(),
    priority: z.enum(INBOX_PRIORITIES).nullable().optional(),
    addTags: z.array(tagName).max(5).optional(),
    removeTags: z.array(tagName).max(10).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to change',
  })
  .refine((value) => !(value.status === 'resolved' && value.followUpAt), {
    message: 'A finished chat cannot have a follow-up',
  });

export type MerchantInboxUpdate = z.infer<typeof merchantInboxUpdateSchema>;

export const merchantInboxSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  page: z.coerce.number().int().min(1).max(50).default(1),
});

export const INBOX_SNIPPET_MAX_LENGTH = 140;
