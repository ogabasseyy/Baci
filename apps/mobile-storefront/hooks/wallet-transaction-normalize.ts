import { z } from 'zod';
import { TransactionRowSchema } from '@/lib/validation';
import type { Transaction } from './wallet-query';

const WalletTransactionDataSchema = TransactionRowSchema.omit({
  amount: true,
  id: true,
}).extend({
  amount: z.union([z.number(), z.string()]),
  id: z.string(),
});

export function coerceDatabaseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return null;
    }

    const numericValue = Number(trimmedValue);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  return null;
}

export function normalizeWalletTransaction(row: unknown): Transaction | null {
  const validation = WalletTransactionDataSchema.safeParse(row);
  if (!validation.success) {
    return null;
  }

  const amount = coerceDatabaseNumber(validation.data.amount);
  if (amount === null) {
    return null;
  }

  return {
    ...validation.data,
    amount,
    description: validation.data.description ?? '',
  };
}
