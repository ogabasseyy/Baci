import { isUint8Array } from 'node:util/types';
import { z } from 'zod';
import { piggyvestEventIdSchema } from './piggyvest-event-id';

export const piggyvestInboxEnqueueSchemas = {
  integrationId: z.uuid(),
  input: z
    .object({
      integrationId: z.uuid(),
      eventId: piggyvestEventIdSchema,
      rawPayload: z.custom<Uint8Array>(
        (value) =>
          isUint8Array(value) &&
          value.byteLength > 0 &&
          value.byteLength <= 65536
      ),
    })
    .strict(),
  response: z
    .array(
      z
        .object({
          inbox_id: z.uuid(),
          outcome: z.enum(['accepted', 'duplicate', 'conflict']),
        })
        .strict()
    )
    .length(1),
};
