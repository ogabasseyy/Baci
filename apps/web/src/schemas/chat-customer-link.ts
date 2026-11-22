import { z } from 'zod';

/** The storefront asks for a link for the store whose chat it is showing. */
export const chatCustomerLinkRequestSchema = z.strictObject({
  storeSlug: z.string().trim().min(1).max(120),
});

/** The contact attribute that carries the signed link (see the token module). */
export const CHAT_CUSTOMER_LINK_ATTRIBUTE = 'baci_customer_link';
