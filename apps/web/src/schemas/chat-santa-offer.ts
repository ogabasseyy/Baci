import { z } from 'zod';

/** Key under which verified Santa offers ride on the outgoing chat message. */
export const CHAT_SANTA_OFFERS_KEY = 'baci_santa_offers';
export const CHAT_SANTA_MAX_OFFERS = 3;

/**
 * A negotiated price the server has checked against the catalog price and the
 * product's maximum discount. Only offers that passed are ever attached.
 */
export const chatSantaOfferSchema = z.object({
  productId: z.string().min(1),
  slug: z.string(),
  name: z.string().min(1).max(200),
  catalogPrice: z.number().positive(),
  grantedPrice: z.number().nonnegative(),
  currency: z.string().min(1).max(8),
});

export type ChatSantaOffer = z.infer<typeof chatSantaOfferSchema>;
