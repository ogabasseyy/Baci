import { z } from 'zod';
import { piggyvestWalletActivityRowSchema } from '@/schemas/piggyvest-wallet-activity';

const pagingRowSchema = z.object({
  id: z.uuid(),
  occurred_at: z.string().min(1),
});

/**
 * The rows of one activity page this server can show. A row it can't (a
 * kind added later, a corrupt field) is left out instead of failing the
 * whole page (Muse). Paging still advances past it: `last` and `count` come
 * from every row the read returned, so no row is skipped or repeated. A
 * reply that isn't a list, or a last row without its paging key, throws.
 */
export function parseWalletActivityRows(data: unknown) {
  const raw = z.array(z.unknown()).parse(data ?? []);
  const rows = raw.flatMap((row) => {
    const parsed = piggyvestWalletActivityRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  const lastRaw = raw.at(-1);
  return {
    rows,
    last: lastRaw === undefined ? undefined : pagingRowSchema.parse(lastRaw),
    count: raw.length,
  };
}
