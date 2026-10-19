import 'server-only';
import z from 'zod';
import { type PiggyvestClientConfig, piggyvestRequest } from './client';

/**
 * PiggyVest accrued-interest reads (sandbox-gated, no live calls).
 *
 * Latest-docs boundary applied: this endpoint returns stored ACCRUALS, which
 * are not proof of payment. Only a verified payout transaction/event counts
 * toward spendable interest (see the savings policy). Cursor pagination over
 * `interest_date_timestamp`; callers iterate explicitly, never unbounded.
 */

const accrualSchema = z.object({
  id: z.string().min(1),
  wallet_id: z.string().min(1),
  amount: z.int(),
  balance: z.int(),
});

export type PiggyvestInterestAccrual = z.infer<typeof accrualSchema>;

const accruedDataSchema = z.object({
  paginatedPayload: z
    .object({
      edges: z.array(accrualSchema),
      pageInfo: z
        .object({
          hasNextPage: z.boolean(),
          endCursor: z.string().nullable().optional(),
        })
        .loose(),
    })
    .loose(),
});

const listInputSchema = z.object({
  walletId: z.string().min(1),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  limit: z.int().positive().max(100).default(31),
  cursor: z.string().min(1).optional(),
  interestType: z.enum(['original', 'differential']).default('original'),
});

export async function listPiggyvestAccruedInterest(
  config: PiggyvestClientConfig,
  input: z.input<typeof listInputSchema>
): Promise<{
  accruals: PiggyvestInterestAccrual[];
  endCursor: string | null;
  hasNextPage: boolean;
}> {
  const parsed = listInputSchema.parse(input);
  const data = await piggyvestRequest(
    config,
    accruedDataSchema,
    `/api/v1/wallet/interests/accrued/${encodeURIComponent(parsed.walletId)}`,
    {
      query: {
        start_date: parsed.startDate,
        end_date: parsed.endDate,
        limit: String(parsed.limit),
        cursor: parsed.cursor,
        interest_type: parsed.interestType,
      },
    }
  );
  return {
    accruals: data.paginatedPayload.edges,
    endCursor: data.paginatedPayload.pageInfo.endCursor ?? null,
    hasNextPage: data.paginatedPayload.pageInfo.hasNextPage,
  };
}
