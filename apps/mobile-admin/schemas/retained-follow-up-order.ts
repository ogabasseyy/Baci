import { oxygenFollowUpOrderSchema } from '@/schemas/oxygen-follow-up-order';

export const retainedFollowUpOrderSchema = oxygenFollowUpOrderSchema.extend({
  created_at: oxygenFollowUpOrderSchema.shape.created_at.nullable(),
});
