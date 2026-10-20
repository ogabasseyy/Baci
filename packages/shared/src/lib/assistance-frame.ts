import { z } from 'zod';
import { searchAssistanceProposalSchema } from './shopping-assistance';

export const assistanceFrameSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().min(1).max(80),
    sequence: z.number().int().min(0),
    event: z.discriminatedUnion('kind', [
      z
        .object({ kind: z.literal('status'), message: z.string().max(160) })
        .strict(),
      z
        .object({
          kind: z.literal('proposal'),
          proposal: searchAssistanceProposalSchema,
        })
        .strict(),
      z.object({ kind: z.literal('done') }).strict(),
      z
        .object({ kind: z.literal('error'), message: z.string().max(160) })
        .strict(),
    ]),
  })
  .strict();

export type SearchAssistanceFrame = z.infer<typeof assistanceFrameSchema>;
