import { z } from 'zod';
import { oxygenFollowUpOrderSchema } from './oxygen-follow-up-order';

export const oxygenFollowUpOrdersSchema = z
  .array(oxygenFollowUpOrderSchema)
  .max(250);
