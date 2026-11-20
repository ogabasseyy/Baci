import { z } from 'zod';

export const bankCardOfferReferenceSchema = z
  .string()
  .regex(/^BCO-[a-f0-9]{32}$/);

export const bankCardOfferTerminalStatusSchema = z.enum([
  'failed',
  'abandoned',
  'cancelled',
  'reversed',
]);
export type BankCardOfferTerminalStatus = z.infer<
  typeof bankCardOfferTerminalStatusSchema
>;
