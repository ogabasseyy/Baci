import { z } from 'zod';
import { MAX_AI_LABEL_LENGTH } from './limits';
import { safeStorefrontUrlSchema } from './safe-storefront-url';

export const safeNavigationLinkSchema = z.strictObject({
  label: z.string().trim().min(1).max(MAX_AI_LABEL_LENGTH),
  url: safeStorefrontUrlSchema,
});
