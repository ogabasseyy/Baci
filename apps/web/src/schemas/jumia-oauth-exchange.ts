import { z } from 'zod';

export const jumiaOAuthExchangeSchema = z.object({
  code: z.string().min(1).max(2048),
  ticketId: z.uuid(),
});
