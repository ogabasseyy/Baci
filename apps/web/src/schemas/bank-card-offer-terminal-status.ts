import { z } from 'zod';

export const bankCardOfferTerminalStatusSchema = z.enum([
  'failed',
  'abandoned',
  'cancelled',
  'reversed',
]);
export type BankCardOfferTerminalStatus = z.infer<
  typeof bankCardOfferTerminalStatusSchema
>;
