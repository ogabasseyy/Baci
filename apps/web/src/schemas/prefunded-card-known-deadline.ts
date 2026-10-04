import { z } from 'zod';

export const PREFUNDED_CARD_KNOWN_DEADLINES = [
  '2026-09-29T15:59:10Z',
  '2026-10-06T15:59:10Z',
] as const;

export const prefundedCardKnownDeadlineSchema = z.enum(
  PREFUNDED_CARD_KNOWN_DEADLINES
);

export type PrefundedCardKnownDeadline = z.infer<
  typeof prefundedCardKnownDeadlineSchema
>;
