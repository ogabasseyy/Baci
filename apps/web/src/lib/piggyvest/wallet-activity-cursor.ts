import { z } from 'zod';

const decodedCursorSchema = z.tuple([
  z.iso.datetime({ offset: true }),
  z.uuid(),
]);

export type WalletActivityCursor = { beforeAt: string; beforeId: string };

/**
 * Keyset cursor for the PiggyVest wallet activity list: the last row's time
 * and id, base64url-encoded so the client treats it as opaque. Decoding
 * returns null for anything that is not exactly that pair.
 */
export const walletActivityCursor = {
  encode(row: { occurred_at: string; id: string }): string {
    return Buffer.from(JSON.stringify([row.occurred_at, row.id])).toString(
      'base64url'
    );
  },
  decode(cursor: string): WalletActivityCursor | null {
    try {
      const parsed = decodedCursorSchema.safeParse(
        JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      );
      if (!parsed.success) return null;
      return { beforeAt: parsed.data[0], beforeId: parsed.data[1] };
    } catch {
      return null;
    }
  },
};
