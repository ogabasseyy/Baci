import { z } from 'zod';
import { MAX_PUBLIC_OBSERVATION_REQUESTS } from '../../tools/experience-runner/public-observation-resource-limit';

const requestId = z.number().int().min(1).max(MAX_PUBLIC_OBSERVATION_REQUESTS);

export const publicCartChannelRequest = z.strictObject({
  url: z.string().max(2048),
  method: z.enum(['GET', 'POST']),
  body: z.string().max(8192).optional(),
});
export const publicCartWorkerFrame = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('request'),
    id: requestId,
    request: publicCartChannelRequest,
  }),
  z.strictObject({ type: z.literal('done'), observation: z.unknown() }),
]);

export const publicCartHostResponse = z.strictObject({
  type: z.literal('response'),
  id: requestId,
  status: z.number().int().min(200).max(299),
  body: z.string(),
});

export type PublicCartChannelRequest = z.infer<typeof publicCartChannelRequest>;
