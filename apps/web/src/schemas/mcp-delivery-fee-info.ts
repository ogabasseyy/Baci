import { z } from 'zod';

export const mcpDeliveryFeeInfoInputSchema = z.object({
  state: z.string().min(2).max(50).describe('Nigerian delivery state'),
  city: z.string().min(2).max(100).optional().describe('Delivery city'),
});
