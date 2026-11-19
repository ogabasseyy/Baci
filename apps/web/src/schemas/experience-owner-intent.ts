import { z } from 'zod';
import { experienceModeExitInput } from '@/schemas/experience-mode-exit';
import { experienceApplyInput } from '@/schemas/experience-publication';
import { experienceToolInputs } from '@/schemas/experience-tools';
export const experienceOwnerIntentInput = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('apply'),
    merchantId: z.uuid(),
    input: experienceApplyInput,
  }),
  z.strictObject({
    action: z.literal('publish'),
    merchantId: z.uuid(),
    input: experienceToolInputs.publish_experience,
  }),
  z.strictObject({
    action: z.literal('rollback'),
    merchantId: z.uuid(),
    input: experienceToolInputs.rollback_experience,
  }),
  z.strictObject({
    action: z.literal('mode-exit'),
    merchantId: z.uuid(),
    input: experienceModeExitInput,
  }),
]);
