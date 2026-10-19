import type { z } from 'zod';
import { ExpenseSchema } from './expense';

export const ExpenseDetailSchema = ExpenseSchema;

export type ExpenseDetail = z.infer<typeof ExpenseDetailSchema>;
